import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { Chat } from './chat.react';

function streamChunks(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function toolOutputBytes(value: unknown): number {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('parts' in value) ||
    !Array.isArray(value.parts)
  ) {
    return 0;
  }

  return value.parts.reduce((total, part) => {
    if (
      part == null ||
      typeof part !== 'object' ||
      !('output' in part) ||
      part.output == null ||
      typeof part.output !== 'object' ||
      !('payload' in part.output) ||
      typeof part.output.payload !== 'string'
    ) {
      return total;
    }

    return total + Buffer.byteLength(part.output.payload);
  }, 0);
}

describe('React Chat publication snapshots', () => {
  it('copies mutable message and part shells without repeatedly cloning tool output payloads', async () => {
    const output = { payload: 'x'.repeat(64 * 1024) };
    const originalStructuredClone = globalThis.structuredClone;
    let clonedToolOutputBytes = 0;

    vi.stubGlobal(
      'structuredClone',
      vi.fn((value: unknown, options?: StructuredSerializeOptions) => {
        clonedToolOutputBytes += toolOutputBytes(value);
        return originalStructuredClone(value, options);
      }),
    );

    const transport: ChatTransport<UIMessage> = {
      async sendMessages() {
        return streamChunks([
          { type: 'start', messageId: 'assistant-1' },
          { type: 'start-step' },
          {
            type: 'tool-input-available',
            toolCallId: 'tool-1',
            toolName: 'demo',
            input: { query: 'hello' },
          },
          {
            type: 'tool-output-available',
            toolCallId: 'tool-1',
            output,
          },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'a' },
          { type: 'text-delta', id: 'text-1', delta: 'b' },
          { type: 'text-end', id: 'text-1' },
          { type: 'finish-step' },
          { type: 'finish' },
        ]);
      },
      async reconnectToStream() {
        return null;
      },
    };

    const chat = new Chat({
      id: 'chat-1',
      generateId: (() => {
        let index = 0;
        return () => `generated-${index++}`;
      })(),
      transport,
    });

    const snapshots: UIMessage[][] = [];
    const unsubscribe = chat['~registerMessagesCallback'](() => {
      snapshots.push(chat.messages);
    });

    try {
      await chat.sendMessage({ text: 'go' });
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }

    expect(clonedToolOutputBytes).toBe(0);

    const assistantSnapshots = snapshots
      .map(messages => messages.at(-1))
      .filter(
        (message): message is UIMessage => message?.role === 'assistant',
      );

    const withOutput = assistantSnapshots.find(message =>
      message.parts.some(
        part => 'output' in part && (part as { output?: unknown }).output === output,
      ),
    );
    const withFirstTextDelta = assistantSnapshots.find(message =>
      message.parts.some(
        part => part.type === 'text' && part.text === 'a',
      ),
    );
    const withSecondTextDelta = assistantSnapshots.find(message =>
      message.parts.some(
        part => part.type === 'text' && part.text === 'ab',
      ),
    );

    expect(withOutput).toBeDefined();
    expect(withFirstTextDelta).toBeDefined();
    expect(withSecondTextDelta).toBeDefined();

    const outputPart = withOutput!.parts.find(part => 'output' in part)!;
    const laterOutputPart = withSecondTextDelta!.parts.find(
      part => 'output' in part,
    )!;
    expect(outputPart).not.toBe(laterOutputPart);
    expect((outputPart as { output?: unknown }).output).toBe(output);
    expect((laterOutputPart as { output?: unknown }).output).toBe(output);

    const firstTextPart = withFirstTextDelta!.parts.find(
      part => part.type === 'text',
    );
    const secondTextPart = withSecondTextDelta!.parts.find(
      part => part.type === 'text',
    );
    expect(firstTextPart).not.toBe(secondTextPart);
    expect(firstTextPart).toMatchObject({ text: 'a' });
    expect(secondTextPart).toMatchObject({ text: 'ab' });
  });
});
