import { describe, expect, it } from 'vitest';
import {
  createClaudeStreamEventState,
  createEmitStreamEvent,
} from './create-emit-stream-event';

describe('external MCP server name identity', () => {
  it('does not suppress an external MCP server merely because the caller named it harness-tools', () => {
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
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'external-collision',
            name: 'mcp__harness-tools__external-query',
            input: { query: 'hello' },
          },
        ],
      },
    });
    emitStreamEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'external-collision',
            content: '{"answer":"world"}',
          },
        ],
      },
    });

    expect(
      emitted.filter(
        event => event.type === 'tool-call' || event.type === 'tool-result',
      ),
    ).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'external-collision',
        toolName: 'mcp__harness-tools__external-query',
        nativeName: 'mcp__harness-tools__external-query',
        input: '{"query":"hello"}',
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'external-collision',
        toolName: 'mcp__harness-tools__external-query',
        result: { answer: 'world' },
        isError: false,
        dynamic: true,
      },
    ]);
  });
});
