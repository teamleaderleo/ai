import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, streamText } from 'ai';

type PatchStatus = 'completed' | 'in_progress';

const sentinelPath = 'fieldwork-sentinel.txt';

function usage() {
  return {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 15,
  };
}

function patchItem(status: PatchStatus, prefix = '') {
  return {
    id: `${prefix}ap_${status}`,
    type: 'apply_patch_call' as const,
    call_id: `${prefix}call_${status}`,
    status,
    operation: {
      type: 'delete_file' as const,
      path: sentinelPath,
    },
  };
}

function jsonResponse(status: PatchStatus) {
  const incomplete = status === 'in_progress';
  return {
    id: `resp_${status}`,
    object: 'response',
    created_at: 1,
    status: incomplete ? 'incomplete' : 'completed',
    error: null,
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
    model: 'gpt-5',
    output: [patchItem(status)],
    usage: usage(),
    metadata: {},
  };
}

function streamEvents(status: PatchStatus) {
  const incomplete = status === 'in_progress';
  const item = patchItem(status, 'stream_');
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
      type: incomplete ? 'response.incomplete' : 'response.completed',
      response: {
        incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
        usage: usage(),
        reasoning: null,
        service_tier: null,
      },
    },
  ];
}

function sseResponse(status: PatchStatus) {
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

function makeScenario(status: PatchStatus, executions: string[]) {
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
      apply_patch: openai.tools.applyPatch({
        execute: async ({ operation }) => {
          executions.push(operation.path);
          return {
            status: 'completed' as const,
            output: 'fieldwork synthetic patch result',
          };
        },
      }),
    },
  };
}

async function runGenerate(status: PatchStatus) {
  const executions: string[] = [];
  const { model, tools } = makeScenario(status, executions);
  const result = await generateText({
    model,
    prompt: 'Use apply_patch once.',
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

async function runStream(status: PatchStatus) {
  const executions: string[] = [];
  const { model, tools } = makeScenario(status, executions);
  const result = streamText({
    model,
    prompt: 'Use apply_patch once.',
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
const generateInProgress = await runGenerate('in_progress');
const streamCompleted = await runStream('completed');
const streamInProgress = await runStream('in_progress');

const receipt = {
  generate: {
    completed: generateCompleted,
    inProgress: generateInProgress,
  },
  stream: {
    completed: streamCompleted,
    inProgress: streamInProgress,
  },
};

console.log(JSON.stringify(receipt, null, 2));

if (
  generateCompleted.executions.length !== 1 ||
  generateCompleted.executions[0] !== sentinelPath
) {
  throw new Error('generate completed control did not execute exactly once');
}

if (
  generateInProgress.executions.length !== 1 ||
  generateInProgress.executions[0] !== sentinelPath
) {
  throw new Error(
    `current-source discriminator changed: generate in-progress executions=${JSON.stringify(generateInProgress.executions)}`,
  );
}

if (
  streamCompleted.executions.length !== 1 ||
  streamCompleted.executions[0] !== sentinelPath
) {
  throw new Error('stream completed control did not execute exactly once');
}

if (streamInProgress.executions.length !== 0) {
  throw new Error(
    `current-source discriminator changed: stream in-progress executions=${JSON.stringify(streamInProgress.executions)}`,
  );
}

if (generateInProgress.finishReason !== 'length') {
  throw new Error(
    `generate in-progress finish reason changed: ${generateInProgress.finishReason}`,
  );
}

if (streamInProgress.finishReason !== 'length') {
  throw new Error(
    `stream in-progress finish reason changed: ${streamInProgress.finishReason}`,
  );
}
