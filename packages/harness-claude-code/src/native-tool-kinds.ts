export type ClaudeCodeNativeToolKind = 'readonly' | 'edit' | 'bash';

const CLAUDE_CODE_NATIVE_TOOL_KIND_ENTRIES = {
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

  // Agent can delegate arbitrary native work and accepts a bypassPermissions
  // mode, so restricted allow-edits must keep it on the approval path.
  Agent: 'bash',
  Bash: 'bash',
  Monitor: 'bash',
  PowerShell: 'bash',
} as const satisfies Readonly<Record<string, ClaudeCodeNativeToolKind>>;

export type ClaudeCodeNativeToolName =
  keyof typeof CLAUDE_CODE_NATIVE_TOOL_KIND_ENTRIES;

/**
 * Native Claude Code tool name -> harness permission kind.
 *
 * The sandbox bridge uses this table to build `permissions.ask` rules and to
 * decide whether an unresolved native tool call must enter the host approval
 * path. The literal source above keeps the known-name type closed while this
 * exported read-only view still supports lookup of runtime-provided strings.
 * Keep aliases that can be emitted by supported Claude runtimes explicit.
 */
export const CLAUDE_CODE_NATIVE_TOOL_KINDS: Readonly<
  Record<string, ClaudeCodeNativeToolKind>
> = CLAUDE_CODE_NATIVE_TOOL_KIND_ENTRIES;
