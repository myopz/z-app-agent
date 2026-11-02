import type { ToolName } from '@z-app-agent/shared'

type JsonSchema = Record<string, unknown>

const ARG_SCHEMAS: Record<ToolName, JsonSchema> = {
  list_files: {
    type: 'object',
    properties: {
      glob: { type: 'string', description: 'Optional path substring filter' },
    },
  },
  read_file: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Workspace-relative path' },
    },
  },
  write_file: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative path, e.g. app/frontend/src/App.tsx',
      },
      content: { type: 'string', description: 'Full file contents' },
    },
  },
  edit_file: {
    type: 'object',
    required: ['path', 'old_string', 'new_string'],
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
    },
  },
  run_command: {
    type: 'object',
    required: ['cmd'],
    properties: {
      cmd: { type: 'string' },
      cwd: { type: 'string' },
      timeout: { type: 'number' },
    },
  },
  install_deps: { type: 'object', properties: {} },
  build: { type: 'object', properties: {} },
  preview: { type: 'object', properties: {} },
  resolve_issue: {
    type: 'object',
    properties: {
      issue_id: { type: 'string' },
    },
  },
  web_search: {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
  },
}

const DESCRIPTIONS: Record<ToolName, string> = {
  list_files: 'List files in the project workspace',
  read_file: 'Read a file from the workspace',
  write_file: 'Create or overwrite a file with full contents (preferred for App.tsx)',
  edit_file: 'Replace an exact substring in an existing file',
  run_command: 'Run a shell command in the workspace',
  install_deps: 'npm install in app/frontend',
  build: 'Typecheck and vite build app/frontend',
  preview: 'Start the Vite preview server',
  resolve_issue: 'Acknowledge issue resolution',
  web_search: 'Search the web (may be unavailable)',
}

/** OpenAI-compatible tools array for chat/completions. */
export function toOpenAiTools(names: ToolName[]) {
  return names.map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: DESCRIPTIONS[name],
      parameters: ARG_SCHEMAS[name],
    },
  }))
}
