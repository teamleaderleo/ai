import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider';
import { convertReadableStreamToArray, mockId } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it } from 'vitest';
import { OpenAIResponsesLanguageModel } from './openai-responses-language-model';

const URL = 'https://api.openai.com/v1/responses';
const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

type FunctionStatus = 'completed' | 'incomplete';
type ShellStatus = 'completed' | 'incomplete';
type ApplyPatchStatus = 'completed' | 'in_progress';
type CustomToolStatus = 'completed' | 'incomplete';
type LocalShellStatus = 'completed' | 'incomplete';
type ToolSearchStatus = 'completed' | 'incomplete';

type StatusCase =
  | { kind: 'function'; status: FunctionStatus }
  | { kind: 'shell'; status: ShellStatus }
  | { kind: 'applyPatch'; status: ApplyPatchStatus }
  | { kind: 'customTool'; status: CustomToolStatus }
  | { kind: 'localShell'; status: LocalShellStatus }
  | { kind: 'toolSearch'; status: ToolSearchStatus };

function outputItem(testCase: StatusCase) {
  switch (testCase.kind) {
    case 'function':
      return {
        id: 'fc_1',
        type: 'function_call' as const,
        call_id: 'call_1',
        name: 'weather',
        arguments: '{"location":"Paris"}',
        status: testCase.status,
      };
    case 'shell':
      return {
        id: 'sh_1',
        type: 'shell_call' as const,
        call_id: 'call_1',
        status: testCase.status,
        action: { commands: ['echo fieldwork-sentinel'] },
      };
    case 'applyPatch':
      return {
        id: 'ap_1',
        type: 'apply_patch_call' as const,
        call_id: 'call_1',
        status: testCase.status,
        operation: {
          type: 'delete_file' as const,
          path: 'fieldwork-sentinel.txt',
        },
      };
    case 'customTool':
      return {
        id: 'ct_1',
        type: 'custom_tool_call' as const,
        call_id: 'call_1',
        name: 'write_sql',
        input: 'SELECT 1',
        status: testCase.status,
      };
    case 'localShell':
      return {
        id: 'ls_1',
        type: 'local_shell_call' as const,
        call_id: 'call_1',
        status: testCase.status,
        action: {
          type: 'exec' as const,
          command: ['echo', 'fieldwork-sentinel'],
          env: {},
        },
      };
    case 'toolSearch':
      return {
        id: 'ts_1',
        type: 'tool_search_call' as const,
        execution: 'client' as const,
        call_id: 'call_1',
        status: testCase.status,
        arguments: { goal: 'find a weather tool' },
      };
  }
}

function toolsFor(
  testCase: StatusCase,
): LanguageModelV4CallOptions['tools'] {
  switch (testCase.kind) {
    case 'function':
      return undefined;
    case 'shell':
      return [
        {
          type: 'provider',
          id: 'openai.shell',
          name: 'shell',
          args: {},
        },
      ];
    case 'applyPatch':
      return [
        {
          type: 'provider',
          id: 'openai.apply_patch',
          name: 'apply_patch',
          args: {},
        },
      ];
    case 'customTool':
      return [
        {
          type: 'provider',
          id: 'openai.custom',
          name: 'write_sql',
          args: {
            description: 'Write a SQL query.',
            format: { type: 'text' },
          },
        },
      ];
    case 'localShell':
      return [
        {
          type: 'provider',
          id: 'openai.local_shell',
          name: 'local_shell',
          args: {},
        },
      ];
    case 'toolSearch':
      return [
        {
          type: 'provider',
          id: 'openai.tool_search',
          name: 'toolSearch',
          args: {
            execution: 'client',
            description: 'Search available tools.',
            parameters: {
              type: 'object',
              properties: { goal: { type: 'string' } },
              required: ['goal'],
              additionalProperties: false,
            },
          },
        },
      ];
  }
}

function isCompleted(testCase: StatusCase) {
  return testCase.status === 'completed';
}

function responseBody(testCase: StatusCase) {
  const completed = isCompleted(testCase);
  return {
    id: `resp_${testCase.kind}_${testCase.status}`,
    object: 'response',
    created_at: 1741257730,
    status: completed ? 'completed' : 'incomplete',
    error: null,
    incomplete_details: completed ? null : { reason: 'max_output_tokens' },
    model: 'gpt-4o-2024-07-18',
    output: [outputItem(testCase)],
    parallel_tool_calls: true,
    store: true,
    tool_choice: 'auto',
    tools: [],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
    metadata: {},
  };
}

const cases: StatusCase[] = [
  { kind: 'function', status: 'completed' },
  { kind: 'function', status: 'incomplete' },
  { kind: 'shell', status: 'completed' },
  { kind: 'shell', status: 'incomplete' },
  { kind: 'applyPatch', status: 'completed' },
  { kind: 'applyPatch', status: 'in_progress' },
  { kind: 'customTool', status: 'completed' },
  { kind: 'customTool', status: 'incomplete' },
  { kind: 'localShell', status: 'completed' },
  { kind: 'localShell', status: 'incomplete' },
  { kind: 'toolSearch', status: 'completed' },
  { kind: 'toolSearch', status: 'incomplete' },
];

describe('OpenAIResponsesLanguageModel completion status', () => {
  const server = createTestServer({ [URL]: {} });

  function createModel() {
    return new OpenAIResponsesLanguageModel('gpt-4o', {
      provider: 'openai',
      url: ({ path }) => `https://api.openai.com/v1${path}`,
      headers: () => ({ Authorization: 'Bearer APIKEY' }),
      generateId: mockId(),
    });
  }

  for (const testCase of cases) {
    const label = `${testCase.kind}:${testCase.status}`;

    it(`doGenerate emits only completed client actions: ${label}`, async () => {
      server.urls[URL].response = {
        type: 'json-value',
        body: responseBody(testCase),
      };

      const result = await createModel().doGenerate({
        prompt: TEST_PROMPT,
        tools: toolsFor(testCase),
      });
      const toolCalls = result.content.filter(part => part.type === 'tool-call');

      expect(toolCalls).toHaveLength(isCompleted(testCase) ? 1 : 0);
      if (!isCompleted(testCase)) {
        expect(result.finishReason.unified).toBe('length');
      }
    });

    it(`doStream emits only completed client actions: ${label}`, async () => {
      const item = outputItem(testCase);
      const completed = isCompleted(testCase);
      const addedItem =
        item.type === 'function_call' || item.type === 'custom_tool_call'
          ? Object.fromEntries(
              Object.entries(item).filter(([key]) => key !== 'status'),
            )
          : item;
      const addedChunks =
        item.type === 'local_shell_call'
          ? []
          : [
              `data: ${JSON.stringify({
                type: 'response.output_item.added',
                output_index: 0,
                item: addedItem,
              })}\n\n`,
            ];

      server.urls[URL].response = {
        type: 'stream-chunks',
        chunks: [
          `data: ${JSON.stringify({
            type: 'response.created',
            response: {
              id: 'resp_stream',
              created_at: 1741257730,
              model: 'gpt-4o-2024-07-18',
              service_tier: null,
            },
          })}\n\n`,
          ...addedChunks,
          `data: ${JSON.stringify({
            type: 'response.output_item.done',
            output_index: 0,
            item,
          })}\n\n`,
          `data: ${JSON.stringify({
            type: completed ? 'response.completed' : 'response.incomplete',
            response: {
              incomplete_details: completed
                ? null
                : { reason: 'max_output_tokens' },
              usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 1,
                output_tokens_details: { reasoning_tokens: 0 },
              },
              reasoning: null,
              service_tier: null,
            },
          })}\n\n`,
          'data: [DONE]\n\n',
        ],
      };

      const result = await createModel().doStream({
        prompt: TEST_PROMPT,
        tools: toolsFor(testCase),
      });
      const parts = await convertReadableStreamToArray(result.stream);
      const toolCalls = parts.filter(part => part.type === 'tool-call');
      const finish = parts.find(part => part.type === 'finish');

      expect(toolCalls).toHaveLength(completed ? 1 : 0);
      if (!completed) {
        expect(
          finish?.type === 'finish' ? finish.finishReason.unified : undefined,
        ).toBe('length');
      }
    });
  }
});
