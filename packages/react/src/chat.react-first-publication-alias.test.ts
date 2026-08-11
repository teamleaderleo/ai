import { describe, expect, it } from 'vitest';
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

describe('React Chat first assistant publication ownership', () => {
  it('currently mutates the first retained assistant publication as later chunks arrive', async () => {
    const transport: ChatTransport<UIMessage> = {
      async sendMessages() {
        return streamChunks([
          { type: 'start', messageId: 'assistant-1' },
          { type: 'start-step' },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'hello' },
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
      id: 'alias-characterization',
      generateId: (() => {
        let index = 0;
        return () => `generated-${index++}`;
      })(),
      transport,
    });

    let firstAssistantPublication: UIMessage[] | undefined;
    let observedPartCount = -1;
    let observedText: string | undefined;

    const unsubscribe = chat['~registerMessagesCallback'](() => {
      if (firstAssistantPublication != null) {
        return;
      }

      const messages = chat.messages;
      const assistant = messages.at(-1);
      if (assistant?.role !== 'assistant') {
        return;
      }

      firstAssistantPublication = messages;
      observedPartCount = assistant.parts.length;
      const textPart = assistant.parts.find(part => part.type === 'text');
      observedText = textPart?.type === 'text' ? textPart.text : undefined;
    });

    try {
      await chat.sendMessage({ text: 'go' });
    } finally {
      unsubscribe();
    }

    expect(firstAssistantPublication).toBeDefined();

    const retainedAssistant = firstAssistantPublication!.at(-1)!;
    const retainedText = retainedAssistant.parts.find(
      part => part.type === 'text',
    );

    // This test intentionally characterizes current behavior for Fieldwork
    // #852. The subscriber retained an earlier messages snapshot, but the
    // assistant object stored inside it was the mutable streaming object.
    expect(retainedAssistant.parts.length).toBeGreaterThan(observedPartCount);
    expect(observedText).toBeUndefined();
    expect(retainedText).toMatchObject({ text: 'hello' });
  });
});
