import { createOpenResponses } from '@ai-sdk/open-responses';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

function responseWithToolCall(status: 'completed' | 'incomplete') {
  return {
    id: `resp_${status}`,
    object: 'response',
    created_at: 1,
    status: status === 'completed' ? 'completed' : 'incomplete',
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

async function run(status: 'completed' | 'incomplete') {
  const executions: string[] = [];
  let requests = 0;

  const provider = createOpenResponses({
    name: 'fieldwork',
    url: 'https://fieldwork.invalid/v1/responses',
    fetch: async () => {
      requests += 1;
      return new Response(JSON.stringify(responseWithToolCall(status)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await generateText({
    model: provider('fieldwork-model'),
    prompt: 'Inspect the record and decide whether to act.',
    stopWhen: stepCountIs(1),
    tools: {
      recordAction: tool({
        inputSchema: z.object({ resource: z.string() }),
        execute: async ({ resource }) => {
          executions.push(resource);
          return { recorded: resource };
        },
      }),
    },
  });

  return {
    status,
    requests,
    executions,
    finishReason: result.finishReason,
    toolCalls: result.toolCalls.map(call => ({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    })),
    toolResults: result.toolResults.length,
  };
}

const completed = await run('completed');
const incomplete = await run('incomplete');

console.log(JSON.stringify({ completed, incomplete }, null, 2));

if (completed.executions.length !== 1) {
  throw new Error('completed control did not execute exactly once');
}

if (incomplete.executions.length !== 1) {
  throw new Error(
    `current-source discriminator changed: incomplete call executed ${incomplete.executions.length} times`,
  );
}

if (incomplete.finishReason !== 'length') {
  throw new Error(
    `expected incomplete response to retain length finish reason, got ${incomplete.finishReason}`,
  );
}
