import { createOpenResponses } from '@ai-sdk/open-responses';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

type CallStatus = 'completed' | 'incomplete';

function responseWithToolCall(status: CallStatus) {
  return {
    id: `resp_${status}`,
    object: 'response',
    created_at: 1,
    status,
    incomplete_details:
      status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    model: 'fieldwork-model',
    output: [
      {
        id: `fc_${status}`,
        type: 'function_call',
        call_id: `call_${status}`,
        name: 'recordAction',
        arguments: JSON.stringify({ resource: 'production-record' }),
        status,
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function sseResponse(status: CallStatus) {
  const item = responseWithToolCall(status).output[0];
  const terminal =
    status === 'completed'
      ? {
          type: 'response.completed',
          sequence_number: 2,
          response: responseWithToolCall(status),
        }
      : {
          type: 'response.incomplete',
          sequence_number: 2,
          response: responseWithToolCall(status),
        };

  const events = [
    {
      type: 'response.output_item.added',
      sequence_number: 0,
      output_index: 0,
      item,
    },
    {
      type: 'response.output_item.done',
      sequence_number: 1,
      output_index: 0,
      item,
    },
    terminal,
  ];

  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') +
      'data: [DONE]\n\n',
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function makeTool(executions: string[]) {
  return tool({
    inputSchema: z.object({ resource: z.string() }),
    execute: async ({ resource }) => {
      executions.push(resource);
      return { recorded: resource };
    },
  });
}

async function runGenerate(status: CallStatus) {
  const executions: string[] = [];

  const provider = createOpenResponses({
    name: 'fieldwork',
    url: 'https://fieldwork.invalid/v1/responses',
    fetch: async () =>
      new Response(JSON.stringify(responseWithToolCall(status)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const result = await generateText({
    model: provider('fieldwork-model'),
    prompt: 'Inspect the record and decide whether to act.',
    stopWhen: stepCountIs(1),
    tools: { recordAction: makeTool(executions) },
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

  const provider = createOpenResponses({
    name: 'fieldwork',
    url: 'https://fieldwork.invalid/v1/responses',
    fetch: async () => sseResponse(status),
  });

  const result = streamText({
    model: provider('fieldwork-model'),
    prompt: 'Inspect the record and decide whether to act.',
    stopWhen: stepCountIs(1),
    tools: { recordAction: makeTool(executions) },
  });

  await result.consumeStream();

  return {
    executions,
    finishReason: await result.finishReason,
    toolCalls: (await result.toolCalls).length,
    toolResults: (await result.toolResults).length,
  };
}

const observed = {
  generate: {
    completed: await runGenerate('completed'),
    incomplete: await runGenerate('incomplete'),
  },
  stream: {
    completed: await runStream('completed'),
    incomplete: await runStream('incomplete'),
  },
};

console.log(JSON.stringify(observed, null, 2));

for (const [mode, cases] of Object.entries(observed)) {
  if (cases.completed.executions.length !== 1) {
    throw new Error(`${mode} completed control did not execute exactly once`);
  }

  if (cases.incomplete.executions.length !== 1) {
    throw new Error(
      `${mode} current-source discriminator changed: incomplete call executed ${cases.incomplete.executions.length} times`,
    );
  }

  if (cases.incomplete.finishReason !== 'length') {
    throw new Error(
      `${mode} expected incomplete response to retain length finish reason, got ${cases.incomplete.finishReason}`,
    );
  }
}
