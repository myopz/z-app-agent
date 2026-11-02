import { nanoid } from 'nanoid'
import { BriefSchema, type Brief } from '@z-app-agent/shared'
import {
  clearCheckpoint,
  clearQueue,
  createRun,
  dequeueMessage,
  getActiveRun,
  getCheckpoint,
  getIssue,
  getProject,
  getResumableRun,
  getRun,
  insertIssue,
  insertMessage,
  listPatchesForMessage,
  saveCheckpoint,
  updateIssueStatus,
  updateRun,
} from '../db/repos.ts'
import { publish } from '../events/bus.ts'
import { updateAtomsDoc } from '../memory/atoms-docs.ts'
import { MAX_FIX_ATTEMPTS } from '../paths.ts'
import { extractFenceJson, runRole } from '../roles/runtime.ts'
import { commitSnapshot } from '../snap/snapshot.ts'
import { isScaffoldApp, localAcceptanceGaps } from '../quality/app-ui.ts'
import { executeTool } from '../tools/executor.ts'
import { workspaceRoot } from '../tools/sandbox-path.ts'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

type Active = {
  controller: AbortController
  runId: string
}

const activeMap = new Map<string, Active>()

function hashWorkspace(projectId: string): string {
  const root = workspaceRoot(projectId)
  const hash = crypto.createHash('sha256')
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else {
        hash.update(p)
        hash.update(fs.readFileSync(p))
      }
    }
  }
  walk(root)
  return hash.digest('hex').slice(0, 16)
}

function checkpoint(projectId: string, runId: string, phase: string, brief: Brief | null) {
  saveCheckpoint(projectId, {
    project_id: projectId,
    run_id: runId,
    phase,
    brief,
    workspace_hash: hashWorkspace(projectId),
    updated_at: new Date().toISOString(),
  })
}

export function stopProject(projectId: string, clearQueued = false) {
  const active = activeMap.get(projectId)
  const runId = active?.runId
  active?.controller.abort()
  activeMap.delete(projectId)
  const run = (runId ? getRun(runId) : undefined) ?? getActiveRun(projectId) ?? getResumableRun(projectId)
  if (run) {
    updateRun(run.id, { status: 'stopped', ended: true, phase: run.phase })
    const existing = getCheckpoint(projectId)?.payload as
      | {
          project_id?: string
          run_id?: string
          phase?: string
          brief?: Brief | null
          workspace_hash?: string
        }
      | undefined
    const brief =
      existing?.brief ??
      (run.brief_json ? (JSON.parse(run.brief_json) as Brief) : null)
    // Refresh hash so resume is not blocked by files written during the stopped run
    saveCheckpoint(projectId, {
      project_id: projectId,
      run_id: run.id,
      phase: run.phase,
      brief,
      workspace_hash: hashWorkspace(projectId),
      updated_at: new Date().toISOString(),
    })
  }
  if (clearQueued) clearQueue(projectId)
  publish(projectId, {
    type: 'run.status',
    run_id: run?.id ?? 'none',
    status: 'stopped',
    phase: run?.phase ?? 'stopped',
  })
  if (run) {
    publish(projectId, {
      type: 'checkpoint',
      resumable: true,
      phase: run.phase,
      run_id: run.id,
    })
  }
}

export async function handleUserMessage(
  projectId: string,
  input: {
    text: string
    mention?: string | null
    answers?: Record<string, string>
    planAction?: { cardId: string; action: 'approve' | 'decline'; reason?: string }
  },
) {
  const project = getProject(projectId)
  if (!project) throw new Error('project_not_found')

  if (input.planAction) {
    return continueAfterPlan(projectId, input.planAction)
  }
  if (input.answers) {
    return continueAfterAnswers(projectId, input.answers)
  }

  const active = getActiveRun(projectId)
  if (active && ['running', 'waiting_plan', 'waiting_answers'].includes(active.status)) {
    if (active.status === 'running') {
      const { enqueueMessage } = await import('../db/repos.ts')
      enqueueMessage(projectId, input)
      insertMessage({
        project_id: projectId,
        role: 'system',
        kind: 'queued',
        content: { text: input.text },
      })
      publish(projectId, {
        type: 'message',
        message_id: nanoid(),
        agent_id: null,
        kind: 'queued',
        content: { text: 'Message queued until current run finishes.' },
      })
      return { queued: true }
    }
  }

  const userMsg = insertMessage({
    project_id: projectId,
    role: 'user',
    kind: 'user',
    content: { text: input.text, mention: input.mention ?? null },
  })
  publish(projectId, {
    type: 'message',
    message_id: userMsg.id,
    agent_id: null,
    kind: 'user',
    content: { text: input.text },
  })

  return startRun(projectId, userMsg.id, input.text, input.mention ?? null)
}

async function startRun(
  projectId: string,
  sourceMessageId: string,
  text: string,
  mention: string | null,
) {
  const project = getProject(projectId)!
  const controller = new AbortController()
  const run = createRun({
    project_id: projectId,
    phase: 'leader_intake',
    source_message_id: sourceMessageId,
  })
  activeMap.set(projectId, { controller, runId: run.id })
  publish(projectId, {
    type: 'run.status',
    run_id: run.id,
    status: 'running',
    phase: 'leader_intake',
  })

  try {
    if (project.collab_mode === 'engineer' || mention === 'alex') {
      await runAlexPath(projectId, run.id, text, null, controller.signal)
    } else {
      await runTeamPath(projectId, run.id, text, sourceMessageId, project.build_mode, controller.signal)
    }
    updateRun(run.id, { status: 'completed', phase: 'done', ended: true })
    clearCheckpoint(projectId)
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'completed',
      phase: 'done',
    })
    activeMap.delete(projectId)
    await drainQueue(projectId)
  } catch (err) {
    if (err instanceof PauseError) {
      // waiting_plan / waiting_answers — keep run open, drop abort controller
      activeMap.delete(projectId)
      return
    }
    activeMap.delete(projectId)
    if (controller.signal.aborted || (err instanceof Error && err.message === 'aborted')) {
      updateRun(run.id, { status: 'stopped', ended: true })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    updateRun(run.id, { status: 'failed', ended: true })
    publish(projectId, { type: 'error', code: 'run_failed', message })
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'failed',
      phase: 'failed',
    })
    await drainQueue(projectId)
  }
}

async function drainQueue(projectId: string) {
  const next = dequeueMessage(projectId)
  if (!next || typeof next !== 'object') return
  const payload = next as {
    text: string
    mention?: string | null
  }
  if (!payload.text) return
  await handleUserMessage(projectId, payload)
}

async function runTeamPath(
  projectId: string,
  runId: string,
  text: string,
  sourceMessageId: string,
  buildMode: string,
  signal: AbortSignal,
) {
  updateRun(runId, { phase: 'leader_intake' })
  checkpoint(projectId, runId, 'leader_intake', null)

  const mike = await runRole({
    projectId,
    runId,
    role: 'mike',
    task: `User request:\n${text}\n\nsource_message_id=${sourceMessageId}\nbuild_mode=${buildMode}\nProduce brief${buildMode === 'goal' ? ' and plan' : ''}.`,
    signal,
  })

  const questions = extractFenceJson<Array<{ id: string; prompt: string; options?: string[] }>>(
    mike.text,
    'questions',
  )
  if (questions?.length) {
    const cardId = nanoid()
    publish(projectId, {
      type: 'card',
      card: { type: 'question', id: cardId, questions },
    })
    updateRun(runId, { status: 'waiting_answers', phase: 'clarify' })
    checkpoint(projectId, runId, 'clarify', null)
    // park — wait for answers via continueAfterAnswers
    await waitForever(signal)
  }

  let brief: Brief
  const rawBrief = extractFenceJson<unknown>(mike.text, 'brief')
  const parsedBrief = BriefSchema.safeParse(
    rawBrief && typeof rawBrief === 'object'
      ? { ...(rawBrief as object), source_message_id: sourceMessageId }
      : null,
  )
  if (parsedBrief.success) {
    brief = enforceUiQualityBrief(parsedBrief.data)
  } else if (rawBrief) {
    publish(projectId, {
      type: 'message',
      message_id: nanoid(),
      agent_id: null,
      kind: 'system',
      content: {
        text: `Brief from Mike needed normalization; fallback applied.\n${parsedBrief.error.message}`,
      },
    })
    brief = BriefSchema.parse({
      goal: text.slice(0, 200),
      sections: [text],
      constraints: [],
      quality_rules: [
        'Must preview successfully',
        'UI must use Tailwind className (no bare unstyled controls)',
      ],
      assignees: ['emma', 'bob', 'alex'],
      acceptance: ['Preview shows a styled UI matching the goal'],
      source_message_id: sourceMessageId,
    })
  } else {
    brief = BriefSchema.parse({
      goal: text.slice(0, 200),
      sections: [text],
      constraints: [],
      quality_rules: [
        'Must preview successfully',
        'UI must use Tailwind className (no bare unstyled controls)',
      ],
      assignees: ['emma', 'bob', 'alex'],
      acceptance: ['Preview shows a styled UI matching the goal'],
      source_message_id: sourceMessageId,
    })
  }
  updateRun(runId, { brief, phase: 'plan_gate' })

  if (buildMode === 'goal') {
    const planMeta = extractFenceJson<{ title?: string; summary?: string }>(mike.text, 'plan')
    const cardId = nanoid()
    publish(projectId, {
      type: 'card',
      card: {
        type: 'plan',
        id: cardId,
        title: planMeta?.title ?? 'Build plan',
        summary: planMeta?.summary ?? brief.goal,
        brief,
        status: 'pending',
      },
    })
    updateRun(runId, { status: 'waiting_plan', phase: 'plan_gate' })
    checkpoint(projectId, runId, 'plan_gate', brief)
    await waitForever(signal)
  }

  await executeSpecialists(projectId, runId, brief, signal)
}

async function continueAfterAnswers(projectId: string, answers: Record<string, string>) {
  const run = getActiveRun(projectId)
  if (!run || run.status !== 'waiting_answers') throw new Error('not_waiting_answers')
  insertMessage({
    project_id: projectId,
    role: 'user',
    kind: 'answers',
    content: { answers },
  })
  const controller = new AbortController()
  activeMap.set(projectId, { controller, runId: run.id })
  updateRun(run.id, { status: 'running', phase: 'leader_intake' })
  const text = `User answers: ${JSON.stringify(answers)}`
  try {
    const project = getProject(projectId)!
    await runTeamPath(
      projectId,
      run.id,
      text,
      run.source_message_id ?? run.id,
      project.build_mode,
      controller.signal,
    )
    updateRun(run.id, { status: 'completed', phase: 'done', ended: true })
    clearCheckpoint(projectId)
    activeMap.delete(projectId)
  } catch (err) {
    activeMap.delete(projectId)
    if (err instanceof PauseError) return
    if (!(err instanceof Error && err.message === 'aborted')) {
      updateRun(run.id, { status: 'failed', ended: true })
      publish(projectId, {
        type: 'error',
        code: 'run_failed',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function continueAfterPlan(
  projectId: string,
  action: { cardId: string; action: 'approve' | 'decline'; reason?: string },
) {
  const run = getActiveRun(projectId)
  if (!run || run.status !== 'waiting_plan') throw new Error('not_waiting_plan')
  if (action.action === 'decline') {
    updateRun(run.id, { status: 'running', phase: 'leader_intake' })
    const controller = new AbortController()
    activeMap.set(projectId, { controller, runId: run.id })
    try {
      await runTeamPath(
        projectId,
        run.id,
        `Plan declined. Reason: ${action.reason ?? 'none'}. Produce a revised plan and brief.`,
        run.source_message_id ?? run.id,
        'goal',
        controller.signal,
      )
      updateRun(run.id, { status: 'completed', phase: 'done', ended: true })
      clearCheckpoint(projectId)
    } finally {
      activeMap.delete(projectId)
    }
    return
  }

  const brief = run.brief_json ? (JSON.parse(run.brief_json) as Brief) : null
  if (!brief) throw new Error('missing_brief')
  const controller = new AbortController()
  activeMap.set(projectId, { controller, runId: run.id })
  updateRun(run.id, { status: 'running', phase: 'handoff_emma' })
  try {
    await executeSpecialists(projectId, run.id, brief, controller.signal)
    updateRun(run.id, { status: 'completed', phase: 'done', ended: true })
    clearCheckpoint(projectId)
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'completed',
      phase: 'done',
    })
    activeMap.delete(projectId)
    await drainQueue(projectId)
  } catch (err) {
    activeMap.delete(projectId)
    if (err instanceof PauseError) return
    if (!(err instanceof Error && err.message === 'aborted')) {
      updateRun(run.id, { status: 'failed', ended: true })
      publish(projectId, {
        type: 'error',
        code: 'run_failed',
        message: err instanceof Error ? err.message : String(err),
      })
    }
    await drainQueue(projectId)
  }
}

async function executeSpecialists(
  projectId: string,
  runId: string,
  brief: Brief,
  signal: AbortSignal,
) {
  updateRun(runId, { phase: 'handoff_emma', brief })
  checkpoint(projectId, runId, 'handoff_emma', brief)
  await runRole({
    projectId,
    runId,
    role: 'emma',
    brief,
    task: 'Refine scope and update .atoms docs for this brief.',
    signal,
  })

  updateRun(runId, { phase: 'handoff_bob' })
  checkpoint(projectId, runId, 'handoff_bob', brief)
  await runRole({
    projectId,
    runId,
    role: 'bob',
    brief,
    task: 'Write architecture into .atoms/ARCHITECTURE.md for this brief.',
    signal,
  })

  await runAlexPath(projectId, runId, 'Implement the brief in the workspace.', brief, signal)
}

function countFrontendPatches(messageId: string): number {
  return listPatchesForMessage(messageId).filter((p) => p.path.includes('app/frontend')).length
}

const UI_QUALITY_RULE =
  "UI must use Tailwind className (no bare unstyled controls); keep index.css as @import 'tailwindcss' (Tailwind v4, not @tailwind directives)"
const UI_ACCEPTANCE = 'Preview shows a Tailwind-styled UI (not bare browser-default markup)'

/** Brief always carries the visual-UI invariant — independent of what Mike emitted. */
function enforceUiQualityBrief(brief: Brief): Brief {
  const quality_rules = brief.quality_rules.some((r) => /tailwind|className|styled UI|bare/i.test(r))
    ? brief.quality_rules
    : [...brief.quality_rules, UI_QUALITY_RULE]
  const acceptance = brief.acceptance.some((a) => /tailwind|styled|视觉|界面/i.test(a))
    ? brief.acceptance
    : [...brief.acceptance, UI_ACCEPTANCE]
  return { ...brief, quality_rules, acceptance }
}

async function runAlexPath(
  projectId: string,
  runId: string,
  task: string,
  brief: Brief | null,
  signal: AbortSignal,
) {
  updateRun(runId, { phase: 'handoff_alex', brief })
  checkpoint(projectId, runId, 'handoff_alex', brief)
  let alex = await runRole({
    projectId,
    runId,
    role: 'alex',
    brief,
    task,
    signal,
    requireWrite: true,
  })

  const uiGaps = localAcceptanceGaps(projectId, brief)
  const needsRewrite =
    isScaffoldApp(projectId) ||
    countFrontendPatches(alex.messageId) === 0 ||
    uiGaps.length > 0
  // Models often describe code or ship bare HTML — force a real styled write pass.
  if (needsRewrite) {
    const reason = isScaffoldApp(projectId)
      ? 'App.tsx is still scaffold/empty'
      : countFrontendPatches(alex.messageId) === 0
        ? 'no app/frontend file writes were recorded'
        : `UI quality gate failed: ${uiGaps.join('; ')}`
    publish(projectId, {
      type: 'message',
      message_id: nanoid(),
      agent_id: null,
      kind: 'system',
      content: {
        text: `${reason} — asking Alex to write_file a styled Tailwind UI for the BRIEF.`,
      },
    })
    alex = await runRole({
      projectId,
      runId,
      role: 'alex',
      brief,
      task: `CRITICAL: ${reason}.
You must call write_file on app/frontend/src/App.tsx with a COMPLETE TypeScript React + Tailwind implementation.
Requirements:
- Satisfy BRIEF acceptance/goal controls
- Every interactive control (<button>/<input>/…) MUST have className
- Use layout utilities (min-h-screen/flex/grid/padding/bg/…) — bare unstyled markup is REJECTED
- Do NOT rewrite app/frontend/src/index.css to @tailwind base/components/utilities — keep @import 'tailwindcss' (Tailwind v4)
Do not only describe the code.`,
      signal,
      requireWrite: true,
    })
  }

  updateRun(runId, { phase: 'install_build' })
  checkpoint(projectId, runId, 'install_build', brief)

  await ensureInstallBuildPreview({
    projectId,
    runId,
    brief,
    signal,
    messageId: alex.messageId,
  })

  updateRun(runId, { phase: 'verify' })
  checkpoint(projectId, runId, 'verify', brief)
  await verifyAcceptance({
    projectId,
    runId,
    brief,
    signal,
    messageId: alex.messageId,
  })

  updateRun(runId, { phase: 'snapshot' })
  await commitSnapshot({
    projectId,
    label: `Version: ${brief?.goal?.slice(0, 48) || 'update'}`,
    messageId: alex.messageId,
    force: true,
  })

  updateAtomsDoc(
    projectId,
    'PROGRESS.md',
    `# Progress\n\n## Latest\n- Alex completed implementation + verify\n- Goal: ${brief?.goal ?? task}\n`,
  )
}

type TrackedIssue = {
  issueId: string
  cardId: string
  phase: string
  summary: string
}

function publishIssueCard(
  projectId: string,
  issue: TrackedIssue,
  status: 'open' | 'resolving' | 'resolved' | 'exhausted',
  summary?: string,
) {
  publish(projectId, {
    type: 'card',
    card: {
      type: 'issue',
      id: issue.cardId,
      issue_id: issue.issueId,
      phase: issue.phase,
      summary: (summary ?? issue.summary).slice(0, 4000),
      status,
    },
  })
}

async function ensureInstallBuildPreview(input: {
  projectId: string
  runId: string
  brief: Brief | null
  signal: AbortSignal
  messageId: string
}) {
  const { projectId, runId, brief, signal, messageId } = input
  let fixAttempts = 0
  let openIssue: TrackedIssue | null = null

  const markResolved = () => {
    if (!openIssue) return
    updateIssueStatus(openIssue.issueId, 'resolved')
    publishIssueCard(projectId, openIssue, 'resolved')
    openIssue = null
  }

  const markExhausted = (issue: TrackedIssue) => {
    updateIssueStatus(issue.issueId, 'exhausted')
    publishIssueCard(projectId, issue, 'exhausted', `${issue.summary}\n\nFix attempts exhausted`)
  }

  const fixPhase = async (phase: string, logs: string) => {
    if (openIssue && openIssue.phase !== phase) {
      updateIssueStatus(openIssue.issueId, 'resolved')
      publishIssueCard(projectId, openIssue, 'resolved')
      openIssue = null
    }
    openIssue = await openIssueAndMaybeFix({
      projectId,
      runId,
      phase,
      logs,
      brief,
      signal,
      attempt: fixAttempts,
      existing: openIssue,
    })
    fixAttempts++
    updateRun(runId, { fix_attempts: fixAttempts })
    if (fixAttempts > MAX_FIX_ATTEMPTS) {
      markExhausted(openIssue)
      throw new Error('fix_exhausted')
    }
  }

  // install with auto-fix
  for (;;) {
    const deps = await executeTool(
      { name: 'install_deps', args: {} },
      { projectId, runId, role: 'alex', messageId, signal },
    )
    if (deps.ok) break
    await fixPhase(
      'install',
      String((deps.data as { output?: string })?.output ?? deps.summary),
    )
  }

  while (fixAttempts <= MAX_FIX_ATTEMPTS) {
    const build = await executeTool(
      { name: 'build', args: {} },
      { projectId, runId, role: 'alex', messageId, signal },
    )
    if (!build.ok) {
      await fixPhase(
        'build',
        String((build.data as { output?: string })?.output ?? build.summary),
      )
      continue
    }

    const preview = await executeTool(
      { name: 'preview', args: {} },
      { projectId, runId, role: 'alex', messageId, signal },
    )
    if (!preview.ok) {
      await fixPhase('preview', String(preview.data ?? preview.summary))
      continue
    }

    markResolved()
    return
  }

  throw new Error('fix_exhausted')
}

async function verifyAcceptance(input: {
  projectId: string
  runId: string
  brief: Brief | null
  signal: AbortSignal
  messageId: string
}) {
  const { projectId, runId, brief, signal, messageId } = input
  const acceptance = brief?.acceptance?.length
    ? brief.acceptance.map((a) => `- ${a}`).join('\n')
    : '- App loads in preview and matches the user goal'

  publish(projectId, {
    type: 'message',
    message_id: nanoid(),
    agent_id: null,
    kind: 'system',
    content: { text: '开始验收测试：对照 BRIEF acceptance 检查实现。' },
  })

  const verify = await runRole({
    projectId,
    runId,
    role: 'alex',
    brief,
    signal,
    requireWrite: false,
    task: `VERIFICATION PASS (read-only first).
1) Use read_file on app/frontend/src/App.tsx and any related UI files.
2) Check acceptance criteria:
${acceptance}
3) Also fail if UI is bare/unstyled (missing Tailwind className on layout and controls).
4) Emit exactly one fence:
\`\`\`verify
{"pass":true,"notes":"short evidence"}
\`\`\`
or
\`\`\`verify
{"pass":false,"notes":"what fails","fix_hint":"concrete code fix"}
\`\`\`
Do NOT say DONE until the verify fence is present. Do not rewrite files in this pass.`,
  })

  const result = extractFenceJson<{ pass?: boolean; notes?: string; fix_hint?: string }>(
    verify.text,
    'verify',
  )

  const localGaps = localAcceptanceGaps(projectId, brief)
  if (result?.pass === true && localGaps.length === 0) {
    publish(projectId, {
      type: 'message',
      message_id: nanoid(),
      agent_id: null,
      kind: 'system',
      content: { text: `验收通过：${result.notes ?? 'acceptance met'}` },
    })
    return
  }

  const failNotes =
    (localGaps.length
      ? `Local check failed: ${localGaps.join('; ')}. `
      : '') +
    (result?.notes ||
      result?.fix_hint ||
      (result?.pass === true
        ? 'Model claimed pass but code does not match acceptance.'
        : 'Verification did not confirm acceptance; implementation may be incomplete.'))

  publish(projectId, {
    type: 'message',
    message_id: nanoid(),
    agent_id: null,
    kind: 'system',
    content: { text: `验收未通过，自动修复中：${failNotes}` },
  })

  const issue = await openIssueAndMaybeFix({
    projectId,
    runId,
    phase: 'verify',
    logs: `${failNotes}\n\nAcceptance:\n${acceptance}`,
    brief,
    signal,
    attempt: 0,
  })

  await ensureInstallBuildPreview({
    projectId,
    runId,
    brief,
    signal,
    messageId,
  })

  updateIssueStatus(issue.issueId, 'resolved')
  publishIssueCard(projectId, issue, 'resolved')

  // second verify after fix
  const recheck = await runRole({
    projectId,
    runId,
    role: 'alex',
    brief,
    signal,
    requireWrite: false,
    task: `Re-verify after fixes. read_file App.tsx and emit:
\`\`\`verify
{"pass":true|false,"notes":"..."}
\`\`\`
Acceptance:
${acceptance}`,
  })
  const re = extractFenceJson<{ pass?: boolean; notes?: string }>(recheck.text, 'verify')
  const reGaps = localAcceptanceGaps(projectId, brief)
  const rePass = re?.pass === true && reGaps.length === 0
  publish(projectId, {
    type: 'message',
    message_id: nanoid(),
    agent_id: null,
    kind: 'system',
    content: {
      text: rePass
        ? `复验通过：${re?.notes ?? 'ok'}`
        : `复验仍有风险：${reGaps.join('; ') || re?.notes || 'manual check recommended'}（build/preview 已通过）`,
    },
  })
}

async function openIssueAndMaybeFix(input: {
  projectId: string
  runId: string
  phase: string
  logs: string
  brief: Brief | null
  signal: AbortSignal
  attempt: number
  existing?: TrackedIssue | null
}): Promise<TrackedIssue> {
  const { projectId, runId, phase, logs, brief, signal, attempt } = input
  const issue: TrackedIssue = input.existing?.phase === phase
    ? { ...input.existing, summary: logs }
    : {
        issueId: insertIssue({ project_id: projectId, run_id: runId, phase, logs }),
        cardId: nanoid(),
        phase,
        summary: logs,
      }

  if (!input.existing || input.existing.phase !== phase) {
    publishIssueCard(projectId, issue, 'open')
  }

  updateIssueStatus(issue.issueId, 'resolving')
  publishIssueCard(projectId, issue, 'resolving')

  await runRole({
    projectId,
    runId,
    role: 'alex',
    brief,
    signal,
    requireWrite: true,
    task: `AUTO-FIX required for ${phase} failure (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS}).
You MUST call write_file or edit_file — explaining alone is failure.

TypeScript rules:
- No implicit any; type event handlers (e.g. ChangeEvent<HTMLInputElement>, FormEvent<HTMLFormElement>)
- Keep React + Tailwind code compiling under strict tsc

Error / verify logs:
${logs.slice(0, 6000)}

Steps: read_file the failing path, then write_file a complete corrected file.
If the failure mentions Tailwind/className/bare controls, restyle the full App.tsx with a finished visual layout.
If the failure mentions index.css / @tailwind / Tailwind v4, restore @import 'tailwindcss' — never use v3 @tailwind directives.`,
  })

  // Stay in resolving until rebuild proves success
  return issue
}

function waitForever(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    // When waiting for user, we abort the controller from outside when continuing — 
    // but continueAfterPlan creates a NEW controller. So we need a different approach:
    // throw a special pause error that startRun treats as soft-stop without failing.
    reject(new PauseError())
  })
}

export class PauseError extends Error {
  constructor() {
    super('paused_for_user')
    this.name = 'PauseError'
  }
}

export async function resumeRun(projectId: string, opts?: { force?: boolean }) {
  const cp = getCheckpoint(projectId)
  if (!cp) throw new Error('nothing_to_resume')
  const payload = cp.payload as {
    workspace_hash: string
    phase: string
    brief: Brief | null
    run_id: string
  }
  const run =
    (payload.run_id ? getRun(payload.run_id) : undefined) ??
    getActiveRun(projectId) ??
    getResumableRun(projectId)
  if (!run) throw new Error('nothing_to_resume')

  if (activeMap.has(projectId)) {
    throw new Error('run_already_active')
  }

  const brief =
    payload.brief ??
    (run.brief_json ? (JSON.parse(run.brief_json) as Brief) : null)
  if (!brief) throw new Error('cannot_resume_without_brief')

  const current = hashWorkspace(projectId)
  if (payload.workspace_hash !== current) {
    if (opts?.force || run.status === 'stopped' || run.status === 'failed') {
      publish(projectId, {
        type: 'message',
        message_id: nanoid(),
        agent_id: null,
        kind: 'system',
        content: {
          text: '工作区自检查点后有变更，已按当前文件继续执行。',
        },
      })
    } else {
      publish(projectId, {
        type: 'error',
        code: 'checkpoint_conflict',
        message: '工作区已变更，无法安全续跑。可恢复版本后重试，或强制继续。',
      })
      publish(projectId, {
        type: 'checkpoint',
        resumable: true,
        phase: payload.phase,
        run_id: run.id,
      })
      throw new Error('checkpoint_conflict')
    }
  }

  const controller = new AbortController()
  activeMap.set(projectId, { controller, runId: run.id })
  updateRun(run.id, { status: 'running', phase: payload.phase })
  saveCheckpoint(projectId, {
    project_id: projectId,
    run_id: run.id,
    phase: payload.phase,
    brief,
    workspace_hash: current,
    updated_at: new Date().toISOString(),
  })
  publish(projectId, {
    type: 'run.status',
    run_id: run.id,
    status: 'running',
    phase: payload.phase,
  })
  publish(projectId, {
    type: 'checkpoint',
    resumable: false,
    phase: payload.phase,
    run_id: run.id,
  })
  publish(projectId, {
    type: 'message',
    message_id: nanoid(),
    agent_id: null,
    kind: 'system',
    content: { text: `从检查点继续：${payload.phase}` },
  })

  try {
    await resumeFromPhase(projectId, run.id, payload.phase, brief, controller.signal)
    updateRun(run.id, { status: 'completed', phase: 'done', ended: true })
    clearCheckpoint(projectId)
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'completed',
      phase: 'done',
    })
    await drainQueue(projectId)
  } catch (err) {
    if (err instanceof PauseError) {
      activeMap.delete(projectId)
      return
    }
    if (controller.signal.aborted || (err instanceof Error && err.message === 'aborted')) {
      updateRun(run.id, { status: 'stopped', ended: true })
      saveCheckpoint(projectId, {
        project_id: projectId,
        run_id: run.id,
        phase: getRun(run.id)?.phase ?? payload.phase,
        brief,
        workspace_hash: hashWorkspace(projectId),
        updated_at: new Date().toISOString(),
      })
      publish(projectId, {
        type: 'checkpoint',
        resumable: true,
        phase: getRun(run.id)?.phase ?? payload.phase,
        run_id: run.id,
      })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    updateRun(run.id, { status: 'failed', ended: true })
    saveCheckpoint(projectId, {
      project_id: projectId,
      run_id: run.id,
      phase: getRun(run.id)?.phase ?? payload.phase,
      brief,
      workspace_hash: hashWorkspace(projectId),
      updated_at: new Date().toISOString(),
    })
    publish(projectId, { type: 'error', code: 'resume_failed', message })
    publish(projectId, {
      type: 'checkpoint',
      resumable: true,
      phase: getRun(run.id)?.phase ?? payload.phase,
      run_id: run.id,
    })
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'failed',
      phase: 'failed',
    })
    throw err
  } finally {
    activeMap.delete(projectId)
  }
}

async function resumeFromPhase(
  projectId: string,
  runId: string,
  phase: string,
  brief: Brief,
  signal: AbortSignal,
) {
  switch (phase) {
    case 'handoff_alex':
    case 'install_build':
      await runAlexPath(
        projectId,
        runId,
        'Resume from checkpoint: finish implementation, build and preview.',
        brief,
        signal,
      )
      return
    case 'handoff_bob':
      updateRun(runId, { phase: 'handoff_bob', brief })
      checkpoint(projectId, runId, 'handoff_bob', brief)
      await runRole({
        projectId,
        runId,
        role: 'bob',
        brief,
        task: 'Write architecture into .atoms/ARCHITECTURE.md for this brief.',
        signal,
      })
      await runAlexPath(projectId, runId, 'Implement the brief in the workspace.', brief, signal)
      return
    case 'plan_gate':
    case 'clarify':
    case 'leader_intake':
    case 'handoff_emma':
    default:
      await executeSpecialists(projectId, runId, brief, signal)
  }
}

export async function resolveIssue(projectId: string, issueId: string) {
  const issue = getIssue(issueId)
  if (!issue || issue.project_id !== projectId) throw new Error('issue_not_found')
  const run = createRun({ project_id: projectId, phase: 'fix_loop' })
  const controller = new AbortController()
  activeMap.set(projectId, { controller, runId: run.id })
  const tracked: TrackedIssue = {
    issueId,
    cardId: nanoid(),
    phase: issue.phase,
    summary: issue.logs,
  }
  try {
    updateIssueStatus(issueId, 'resolving')
    publishIssueCard(projectId, tracked, 'resolving')
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'running',
      phase: 'fix_loop',
    })

    await openIssueAndMaybeFix({
      projectId,
      runId: run.id,
      phase: issue.phase,
      logs: issue.logs,
      brief: null,
      signal: controller.signal,
      attempt: 0,
      existing: tracked,
    })

    await ensureInstallBuildPreview({
      projectId,
      runId: run.id,
      brief: null,
      signal: controller.signal,
      messageId: run.id,
    })

    updateIssueStatus(issueId, 'resolved')
    publishIssueCard(projectId, tracked, 'resolved')
    await commitSnapshot({
      projectId,
      label: `Fix: ${issue.phase}`,
      force: true,
    })
    updateRun(run.id, { status: 'completed', phase: 'done', ended: true })
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'completed',
      phase: 'done',
    })
  } catch (err) {
    updateIssueStatus(issueId, 'open')
    publishIssueCard(projectId, tracked, 'open')
    updateRun(run.id, { status: 'failed', ended: true })
    publish(projectId, {
      type: 'run.status',
      run_id: run.id,
      status: 'failed',
      phase: 'failed',
    })
    throw err
  } finally {
    activeMap.delete(projectId)
  }
}

export function listResumableOnBoot() {
  // imported lazily via repos in index boot path
}
