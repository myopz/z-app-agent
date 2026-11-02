import fs from 'node:fs'
import path from 'node:path'
import * as tar from 'tar'
import { nanoid } from 'nanoid'
import {
  getVersion,
  insertMessage,
  insertVersion,
  listPatchesForMessage,
  listVersions,
} from '../db/repos.ts'
import { publish } from '../events/bus.ts'
import { SNAPSHOTS_ROOT } from '../paths.ts'
import { resolveInWorkspace, workspaceRoot } from '../tools/sandbox-path.ts'

function workspaceDirty(projectId: string, sinceMessageId?: string): boolean {
  if (!sinceMessageId) {
    // any files beyond template baseline — check patches exist for project
    return true
  }
  return listPatchesForMessage(sinceMessageId).length > 0
}

export async function commitSnapshot(input: {
  projectId: string
  label: string
  messageId?: string
  parentId?: string | null
  force?: boolean
}): Promise<{ id: string; label: string; created_at: string } | null> {
  const root = workspaceRoot(input.projectId)
  if (!fs.existsSync(root)) return null

  // Only snapshot when there are patches in this message, or force
  if (!input.force && input.messageId && !workspaceDirty(input.projectId, input.messageId)) {
    const anyPatches = listPatchesForMessage(input.messageId)
    if (anyPatches.length === 0) return null
  }

  const versionId = nanoid()
  const dir = path.join(SNAPSHOTS_ROOT, input.projectId)
  fs.mkdirSync(dir, { recursive: true })
  const snapshotPath = path.join(dir, `${versionId}.tar`)

  await tar.create(
    {
      gzip: true,
      file: snapshotPath,
      cwd: root,
      filter: (p) => !p.includes('node_modules') && !p.includes('/dist/') && p !== 'dist',
    },
    ['.'],
  )

  const versions = listVersions(input.projectId)
  const parent = input.parentId ?? versions[0]?.id ?? null
  const ver = insertVersion({
    project_id: input.projectId,
    label: input.label,
    parent_id: parent,
    snapshot_path: snapshotPath,
    message_id: input.messageId,
  })

  publish(input.projectId, {
    type: 'card',
    card: {
      type: 'version',
      id: nanoid(),
      version_id: ver.id,
      label: ver.label,
      created_at: ver.created_at,
    },
  })

  insertMessage({
    project_id: input.projectId,
    role: 'system',
    kind: 'version',
    content: {
      version_id: ver.id,
      label: ver.label,
      created_at: ver.created_at,
    },
  })

  return ver
}

export async function restoreVersion(projectId: string, versionId: string) {
  const ver = getVersion(versionId)
  if (!ver || ver.project_id !== projectId) throw new Error('version_not_found')
  const root = workspaceRoot(projectId)
  // clear files except node_modules
  for (const entry of fs.readdirSync(root)) {
    if (entry === 'node_modules') continue
    fs.rmSync(path.join(root, entry), { recursive: true, force: true })
  }
  await tar.extract({ file: ver.snapshot_path, cwd: root })
  insertMessage({
    project_id: projectId,
    role: 'system',
    kind: 'restore',
    content: { version_id: versionId, label: ver.label },
  })
  publish(projectId, {
    type: 'message',
    message_id: nanoid(),
    agent_id: null,
    kind: 'restore',
    content: { version_id: versionId, label: ver.label },
  })
}

export function revertMessage(projectId: string, messageId: string) {
  const patches = listPatchesForMessage(messageId)
  if (patches.length === 0) throw new Error('no_patches')
  // apply in reverse
  for (const p of [...patches].reverse()) {
    const abs = resolveInWorkspace(projectId, p.path)
    if (p.before_text === null) {
      if (fs.existsSync(abs)) fs.rmSync(abs)
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, p.before_text)
    }
  }
  insertMessage({
    project_id: projectId,
    role: 'system',
    kind: 'revert',
    content: { message_id: messageId, files: patches.map((p) => p.path) },
  })
  publish(projectId, {
    type: 'message',
    message_id: nanoid(),
    agent_id: null,
    kind: 'revert',
    content: { message_id: messageId },
  })
}
