export type ClaudeCodeNativeToolKind = 'readonly' | 'edit' | 'bash';

/**
 * Native Claude Code tool name -> harness permission kind.
 *
 * The sandbox bridge uses this table to build `permissions.ask` rules and to
 * decide whether an unresolved native tool call must enter the host approval
 * path. Keep aliases that can be emitted by supported Claude runtimes explicit.
 */
export const CLAUDE_CODE_NATIVE_TOOL_KINDS = {
  Read: 'readonly',
  Glob: 'readonly',
  Grep: 'readonly',
  WebSearch: 'readonly',
  WebFetch: 'readonly',
  TaskGet: 'readonly',
  TaskList: 'readonly',
  TaskOutput: 'readonly',
  ListMcpResources: 'readonly',
  ReadMcpResource: 'readonly',
  ListMcpResourcesTool: 'readonly',
  ReadMcpResourceTool: 'readonly',
  ReadMcpResourceDirTool: 'readonly',
  RefreshMcpTools: 'readonly',
  EnterPlanMode: 'readonly',
  CronList: 'readonly',
  LSP: 'readonly',
  ReportFindings: 'readonly',
  SendUserFile: 'readonly',
  WaitForMcpServers: 'readonly',
  Skill: 'readonly',
  AskUserQuestion: 'readonly',
  ToolSearch: 'readonly',

  Write: 'edit',
  Edit: 'edit',
  NotebookEdit: 'edit',
  TodoWrite: 'edit',
  TaskCreate: 'edit',
  TaskUpdate: 'edit',
  TaskStop: 'edit',
  EnterWorktree: 'edit',
  ExitWorktree: 'edit',
  ExitPlanMode: 'edit',
  Artifact: 'edit',
  CronCreate: 'edit',
  CronDelete: 'edit',
  DesignSync: 'edit',
  PushNotification: 'edit',
  RemoteTrigger: 'edit',
  ScheduleWakeup: 'edit',
  SendMessage: 'edit',
  ShareOnboardingGuide: 'edit',
  Workflow: 'edit',

  Bash: 'bash',
  Monitor: 'bash',
  PowerShell: 'bash',
} as const satisfies Readonly<Record<string, ClaudeCodeNativeToolKind>>;
