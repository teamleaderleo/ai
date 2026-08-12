import { tool } from '@ai-sdk/provider-utils';
import {
  convertArrayToReadableStream,
  convertAsyncIterableToArray,
} from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { streamText } from './stream-text';

const failure = new Error('mid-stream provider failure');

function createModel(parts: Parameters<typeof convertArrayToReadableStream>[0]) {
  const doStream = vi.fn(async () => ({
    stream: convertArrayToReadableStream(parts),
  }));

  return {
    model: new MockLanguageModelV4({ doStream }),
    doStream,
  };
}

describe('Fieldwork #886: mid-stream recovery boundary', () => {
  it('does not retry after a returned provider stream errors before semantic output', async () => {
    const { model, doStream } = createModel([
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: failure },
    ]);

    const result = streamText({
      model,
      prompt: 'retry this stream',
      maxRetries: 2,
      onError: () => {},
    });

    const parts = await convertAsyncIterableToArray(result.fullStream);

    expect(doStream).toHaveBeenCalledTimes(1);
    expect(parts).toContainEqual({ type: 'error', error: failure });
    await expect(result.steps).rejects.toThrow('No output generated');
  });

  it('publishes partial text before the provider stream error without retrying', async () => {
    const { model, doStream } = createModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'partial' },
      { type: 'error', error: failure },
    ]);

    const result = streamText({
      model,
      prompt: 'retry this partial stream',
      maxRetries: 2,
      onError: () => {},
    });

    const parts = await convertAsyncIterableToArray(result.fullStream);

    expect(doStream).toHaveBeenCalledTimes(1);
    expect(parts).toContainEqual({ type: 'text-delta', id: 'text-1', text: 'partial' });
    expect(parts).toContainEqual({ type: 'error', error: failure });
    await expect(result.steps).rejects.toThrow('No output generated');
  });

  it('can execute a tool side effect before the failed step is committed', async () => {
    let executions = 0;

    const effectTool = tool({
      description: 'Record one external effect',
      inputSchema: z.object({}),
      execute: async () => {
        executions++;
        return { executed: executions };
      },
    });

    const { model, doStream } = createModel([
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'call-effect',
        toolName: 'effect',
        input: '{}',
      },
      { type: 'error', error: failure },
    ]);

    const result = streamText({
      model,
      prompt: 'run the tool then fail',
      tools: { effect: effectTool },
      maxRetries: 2,
      onError: () => {},
    });

    const parts = await convertAsyncIterableToArray(result.fullStream);

    expect(doStream).toHaveBeenCalledTimes(1);
    expect(executions).toBe(1);
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'call-effect',
        toolName: 'effect',
      }),
    );
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'call-effect',
        toolName: 'effect',
      }),
    );
    expect(parts).toContainEqual({ type: 'error', error: failure });
    await expect(result.steps).rejects.toThrow('No output generated');
  });
});
