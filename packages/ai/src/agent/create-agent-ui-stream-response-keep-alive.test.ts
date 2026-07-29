import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import {
  createAgentUIStreamResponse,
} from './create-agent-ui-stream-response';
import { ToolLoopAgent } from './tool-loop-agent';

const testUsage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: undefined,
  },
};

describe('createAgentUIStreamResponse keepAliveMs', () => {
  it('forwards keepAliveMs to the client response helper', async () => {
    const agent = new ToolLoopAgent({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'stream-start' as const, warnings: [] },
            { type: 'text-start' as const, id: 'text-1' },
            {
              type: 'text-delta' as const,
              id: 'text-1',
              delta: 'Hello',
            },
            { type: 'text-end' as const, id: 'text-1' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: testUsage,
            },
          ]),
        }),
      }),
    });

    const response = await createAgentUIStreamResponse({
      agent,
      uiMessages: [
        {
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        },
      ],
      keepAliveMs: 1000,
    });
    const reader = response.body!
      .pipeThrough(new TextDecoderStream())
      .getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: ': stream-open\n\n',
    });
    await reader.cancel();
  });
});
