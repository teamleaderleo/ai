import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { Chat } from './chat.react';

class ManualTransport implements ChatTransport<UIMessage> {
  controller: ReadableStreamDefaultController<UIMessageChunk> | undefined;

  async sendMessages() {
    return new ReadableStream<UIMessageChunk>({
      start: controller => {
        this.controller = controller;
      },
    });
  }

  async reconnectToStream() {
    return null;
  }

  emit(chunk: UIMessageChunk) {
    this.controller?.enqueue(chunk);
  }

  close() {
    this.controller?.close();
  }
}

describe('Fieldwork: first assistant publication ownership', () => {
  it('characterizes the first published assistant snapshot aliasing mutable response state', async () => {
    const transport = new ManualTransport();
    const chat = new Chat({
      id: 'first-publication-alias',
      generateId: (() => {
        let index = 0;
        return () => `generated-${index++}`;
      })(),
      transport,
    });

    const publications: UIMessage[][] = [];
    const unsubscribe = chat['~registerMessagesCallback'](() => {
      publications.push(chat.messages);
    });

    const request = chat.sendMessage({ text: 'go' });
    await vi.waitFor(() => expect(transport.controller).toBeDefined());

    transport.emit({ type: 'text-start', id: 'text-1' });
    await vi.waitFor(() => {
      expect(
        publications.some(messages =>
          messages.some(
            message =>
              message.role === 'assistant' &&
              message.parts.some(
                part => part.type === 'text' && part.text === '',
              ),
          ),
        ),
      ).toBe(true);
    });

    const firstAssistantPublication = publications
      .flatMap(messages => messages)
      .find(message => message.role === 'assistant')!;
    const firstTextPart = firstAssistantPublication.parts.find(
      part => part.type === 'text',
    )!;

    expect(firstTextPart.text).toBe('');

    transport.emit({ type: 'text-delta', id: 'text-1', delta: 'hello' });
    await vi.waitFor(() => {
      expect(
        chat.messages
          .at(-1)
          ?.parts.find(part => part.type === 'text')
          ?.text,
      ).toBe('hello');
    });

    // Characterization of current behavior: the exact object retained from
    // the earlier publication changes when the internal response state handles
    // a later chunk. Desired immutable-snapshot behavior would keep this ''.
    expect(firstTextPart.text).toBe('hello');

    transport.emit({ type: 'text-end', id: 'text-1' });
    transport.emit({ type: 'finish' });
    transport.close();

    await request;
    unsubscribe();
  });
});
