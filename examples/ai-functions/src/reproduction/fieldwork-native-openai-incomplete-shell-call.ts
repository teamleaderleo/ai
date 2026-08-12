import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, streamText } from 'ai';

type CallStatus = 'completed' | 'incomplete';

const sentinelCommand = 'echo fieldwork-sentinel';

function usage() {
  return {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 15,
  };
}

function shellItem(status: CallStatus, prefix = '') {
  return {
    id: `${prefix}sh_${status}`,
    type: 'shell_call' as const,
    call_id: `${prefix}call_${status}`,
    status,
    action: { commands: [sentinelCommand] },
  };
}

function jsonResponse(status: CallStatus) {
  return {
    id: `resp_${status}`,
    object: 'response',
    created_at: 1,
    status,
    error: null,
    incomplete_details:
      status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    model: 'gpt-5',
    output: [shellItem(status)],
    usage: usage(),
    metadata: {},
  };
}

function streamEvents(status: CallStatus) {
  const item = shellItem(status, 'stream_');
  return [
    {
      type: 'response.created',
      response: {
        id: `resp_stream_${status}`,
        created_at: 1,
        model: 'gpt-5',
        service_tier: null,
      },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item,
    },
    {
      type:
        status === 'completed' ? 'response.completed' : 'response.incomplete',
      response: {
        incomplete_details:
          status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
        usage: usage(),
        reasoning: null,
        service_tier: null,
      },
    },
  ];
}

function sseResponse(status: CallStatus) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of streamEvents(status)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function makeScenario(status: CallStatus, executions: string[]) {
  const openai = createOpenAI({
    apiKey: 'fieldwork-key',
    baseURL: 'https://fieldwork.invalid/v1',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        stream?: boolean;
      };
      return request.stream
        ? sseResponse(status)
        : new Response(JSON.stringify(jsonResponse(status)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    },
  });

  return {
    model: openai.responses('gpt-5'),
    tools: {
      shell: openai.tools.shell({
        execute: async ({ action }) => {
          executions.push(...action.commands);
          return {
            output: action.commands.map(() => ({
              stdout: 'fieldwork synthetic output',
              stderr: '',
              outcome: { type: 'exit' as const, exitCode: 0 },
            })),
          };
        },
      }),
    },
  };
}

async function runGenerate(status: CallStatus) {
  const executions: string[] = [];
  const { model, tools } = makeScenario(status, executions);
  const result = await generateText({
    model,
    prompt: 'Use the shell tool once.',
    tools,
    stopWhen: stepCountIs(1),
  });

  return {
    executions,
    finishReason: result.finishReason,
    toolCalls: result.toolCalls.length,
    toolResults: result.toolResults.length,
  };
}

async function runStream(status: CallStatus) {
  const executions: string[] = [];
  const { model, tools } = makeScenario(status, executions);
  const result = streamText({
    model,
    prompt: 'Use the shell tool once.',
    tools,
    stopWhen: stepCountIs(1),
  });

  let toolCalls = 0;
  let toolResults = 0;
  for await (const part of result.fullStream) {
    if (part.type === 'tool-call') toolCalls += 1;
    if (part.type === 'tool-result') toolResults += 1;
  }

  return {
    executions,
    finishReason: await result.finishReason,
    toolCalls,
    toolResults,
  };
}

const generateCompleted = await runGenerate('completed');
const generateIncomplete = await runGenerate('incomplete');
const streamCompleted = await runStream('completed');
const streamIncomplete = await runStream('incomplete');

const receipt = {
  generate: {
    completed: generateCompleted,
    incomplete: generateIncomplete,
  },
  stream: {
    completed: streamCompleted,
    incomplete: streamIncomplete,
  },
};

console.log(JSON.stringify(receipt, null, 2));

for (const [label, value] of [
  ['generate completed', generateCompleted],
  ['generate incomplete', generateIncomplete],
  ['stream completed', streamCompleted],
  ['stream incomplete', streamIncomplete],
] as const) {
  if (value.executions.length !== 1 || value.executions[0] !== sentinelCommand) {
    throw new Error(`${label} execution receipt changed: ${JSON.stringify(value.executions)}`);
  }
}

if (generateIncomplete.finishReason !== 'length') {
  throw new Error(
    `generate incomplete finish reason changed: ${generateIncomplete.finishReason}`,
  );
}

if (streamIncomplete.finishReason !== 'length') {
  throw new Error(
    `stream incomplete finish reason changed: ${streamIncomplete.finishReason}`,
  );
}
