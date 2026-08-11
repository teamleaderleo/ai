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

type Publication = {
  messages: UIMessage[];
  observedText: string | undefined;
  observedOutput: unknown;
};

function readPublication(messages: UIMessage[]): Publication {
  const assistant = messages.at(-1);
  const textPart = assistant?.parts.find(part => part.type === 'text');
  const outputPart = assistant?.parts.find(part => 'output' in part);

  return {
    messages,
    observedText: textPart?.type === 'text' ? textPart.text : undefined,
    observedOutput:
      outputPart && 'output' in outputPart ? outputPart.output : undefined,
  };
}

describe('React Chat publication snapshots', () => {
  it('copies replacement message and part shells without repeatedly cloning tool output payloads', async () => {
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

    const publications: Publication[] = [];
    const unsubscribe = chat['~registerMessagesCallback'](() => {
      publications.push(readPublication(chat.messages));
    });

    try {
      await chat.sendMessage({ text: 'go' });
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }

    expect(clonedToolOutputBytes).toBe(0);

    // Select publications by what the subscriber observed at callback time.
    // The first new-assistant publication currently aliases mutable response
    // state (tracked separately in Fieldwork #852), so selecting by the
    // retained object's final contents would conflate that earlier publication
    // with later replacement snapshots.
    const withOutput = publications.find(
      publication => publication.observedOutput === output,
    );
    const withFirstTextDelta = publications.find(
      publication => publication.observedText === 'a',
    );
    const withSecondTextDelta = publications.find(
      publication => publication.observedText === 'ab',
    );

    expect(withOutput).toBeDefined();
    expect(withFirstTextDelta).toBeDefined();
    expect(withSecondTextDelta).toBeDefined();

    const outputMessage = withOutput!.messages.at(-1)!;
    const firstTextMessage = withFirstTextDelta!.messages.at(-1)!;
    const secondTextMessage = withSecondTextDelta!.messages.at(-1)!;

    const outputPart = outputMessage.parts.find(part => 'output' in part)!;
    const laterOutputPart = secondTextMessage.parts.find(
      part => 'output' in part,
    )!;
    expect(outputPart).not.toBe(laterOutputPart);
    expect((outputPart as { output?: unknown }).output).toBe(output);
    expect((laterOutputPart as { output?: unknown }).output).toBe(output);

    const firstTextPart = firstTextMessage.parts.find(
      part => part.type === 'text',
    );
    const secondTextPart = secondTextMessage.parts.find(
      part => part.type === 'text',
    );
    expect(firstTextPart).not.toBe(secondTextPart);
    expect(firstTextPart).toMatchObject({ text: 'a' });
    expect(secondTextPart).toMatchObject({ text: 'ab' });
  });
});
