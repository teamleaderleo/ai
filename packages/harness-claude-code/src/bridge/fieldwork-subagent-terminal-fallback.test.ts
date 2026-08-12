import { describe, expect, it } from 'vitest';
import {
  createClaudeStreamEventState,
  createEmitStreamEvent,
} from './create-emit-stream-event';

describe('Fieldwork #866: Claude subagent terminal fallback', () => {
  it(
    'keeps a filtered subagent assistant error out of parent terminal fallback state',
    () => {
      const state = createClaudeStreamEventState();
      const emitted: Record<string, unknown>[] = [];
      const terminalErrors: Array<string | undefined> = [];

      const emitStreamEvent = createEmitStreamEvent({
        state,
        emit: event => emitted.push(event),
        emitWarning: () => {},
        emitTerminalError: error => terminalErrors.push(error),
        onCompactionBoundary: () => {},
        toCommonName: name => name,
      });

      emitStreamEvent({
        type: 'assistant',
        parent_tool_use_id: 'toolu_parent',
        error: 'server_error',
        message: {
          content: [{ type: 'text', text: 'subagent failed' }],
        },
      });

      expect(emitted).toEqual([{ type: 'stream-start' }]);
      expect(terminalErrors).toEqual([]);
      expect(state.observedTerminalError).toBeUndefined();
    },
  );

  it('still records a main-agent assistant error in terminal fallback state', () => {
    const state = createClaudeStreamEventState();
    const emitted: Record<string, unknown>[] = [];

    const emitStreamEvent = createEmitStreamEvent({
      state,
      emit: event => emitted.push(event),
      emitWarning: () => {},
      emitTerminalError: () => {},
      onCompactionBoundary: () => {},
      toCommonName: name => name,
    });

    emitStreamEvent({
      type: 'assistant',
      error: 'server_error',
      message: {
        content: [{ type: 'text', text: 'parent failed' }],
      },
    });

    expect(emitted).toEqual([{ type: 'stream-start' }]);
    expect(state.observedTerminalError).toBe('server_error');
  });

  it('keeps ordinary filtered subagent output out of parent state', () => {
    const state = createClaudeStreamEventState();
    const emitted: Record<string, unknown>[] = [];

    const emitStreamEvent = createEmitStreamEvent({
      state,
      emit: event => emitted.push(event),
      emitWarning: () => {},
      emitTerminalError: () => {},
      onCompactionBoundary: () => {},
      toCommonName: name => name,
    });

    emitStreamEvent({
      type: 'assistant',
      parent_tool_use_id: 'toolu_parent',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_subagent',
            name: 'Bash',
            input: { command: 'false' },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    });

    expect(emitted).toEqual([{ type: 'stream-start' }]);
    expect(state.observedTerminalError).toBeUndefined();
    expect(state.pendingStepToolUseIds.size).toBe(0);
    expect(state.nativeToolCallNames.size).toBe(0);
  });
});
