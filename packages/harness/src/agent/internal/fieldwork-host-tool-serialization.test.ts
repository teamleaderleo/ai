import {
  tool,
  type Experimental_SandboxSession,
  type ToolSet,
} from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import type {
  HarnessV1,
  HarnessV1PromptControl,
  HarnessV1PromptTurnOptions,
  HarnessV1Session,
  HarnessV1StreamPart,
} from '../../v1';
import { runPrompt } from './run-prompt';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
};

function fakeSession(
  script: HarnessV1StreamPart[],
  submittedResults: Array<{ toolCallId: string; output: unknown }>,
): HarnessV1Session {
  const emitScript = (emit: (event: HarnessV1StreamPart) => void) => {
    const control: HarnessV1PromptControl = {
      submitToolResult: async input => {
        submittedResults.push({
          toolCallId: input.toolCallId,
          output: input.output,
        });
      },
      done: Promise.resolve(),
    };

    queueMicrotask(() => {
      for (const event of script) {
        emit(event);
      }
    });

    return control;
  };

  return {
    sessionId: 'fieldwork-host-tool-session',
    isResume: false,
    doPromptTurn: async (options: HarnessV1PromptTurnOptions) =>
      emitScript(options.emit),
    doContinueTurn: async options => emitScript(options.emit),
    doCompact: async () => {},
    doDetach: async () => ({
      type: 'resume-session',
      harnessId: 'fieldwork-host-tool-harness',
      specificationVersion: 'harness-v1',
      data: {},
    }),
    doStop: async () => ({
      type: 'resume-session',
      harnessId: 'fieldwork-host-tool-harness',
      specificationVersion: 'harness-v1',
      data: {},
    }),
    doDestroy: async () => {},
    doSuspendTurn: async () => ({
      type: 'continue-turn',
      harnessId: 'fieldwork-host-tool-harness',
      specificationVersion: 'harness-v1',
      data: {},
    }),
  };
}

const harness: HarnessV1 = {
  specificationVersion: 'harness-v1',
  harnessId: 'fieldwork-host-tool-harness',
  builtinTools: {},
  doStart: async () => fakeSession([], []),
};

describe('Fieldwork #883: HarnessAgent host tool concurrency', () => {
  it('serializes host tool execution in bridge event order', async () => {
    const firstStarted = deferred();
    const secondStarted = deferred();
    const releaseFirst = deferred();
    const releaseSecond = deferred();
    const submittedResults: Array<{ toolCallId: string; output: unknown }> = [];
    let secondHasStarted = false;

    const first = tool({
      description: 'First host tool',
      inputSchema: z.object({}),
      execute: async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return { tool: 'first' };
      },
    });

    const second = tool({
      description: 'Second host tool',
      inputSchema: z.object({}),
      execute: async () => {
        secondHasStarted = true;
        secondStarted.resolve();
        await releaseSecond.promise;
        return { tool: 'second' };
      },
    });

    const session = fakeSession(
      [
        {
          type: 'tool-call',
          toolCallId: 'call-first',
          toolName: 'first',
          input: '{}',
        },
        {
          type: 'tool-call',
          toolCallId: 'call-second',
          toolName: 'second',
          input: '{}',
        },
        {
          type: 'finish-step',
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
        },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'end_turn' },
          totalUsage: usage,
        },
      ],
      submittedResults,
    );

    const { result, done } = runPrompt({
      harness,
      session,
      prompt: 'run both tools',
      instructions: undefined,
      tools: { first, second } as ToolSet,
      toolSpecs: [],
      sandboxSession: {} as Experimental_SandboxSession,
      sessionWorkDir: '/vercel/sandbox/fieldwork',
      runtimeContext: {} as never,
      abortSignal: undefined,
    });

    const drain = result.consumeStream();

    await firstStarted.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect(secondHasStarted).toBe(false);
    expect(submittedResults).toEqual([]);

    releaseFirst.resolve();
    await secondStarted.promise;

    expect(submittedResults).toEqual([
      { toolCallId: 'call-first', output: { tool: 'first' } },
    ]);

    releaseSecond.resolve();
    await Promise.all([done, drain]);

    expect(submittedResults).toEqual([
      { toolCallId: 'call-first', output: { tool: 'first' } },
      { toolCallId: 'call-second', output: { tool: 'second' } },
    ]);
  });
});
