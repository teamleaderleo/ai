import { describe, expect, it } from 'vitest';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { Chat } from './chat.react';

type AnyMessage = UIMessage & {
  parts: Array<Record<string, any>>;
};

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

async function tick() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function findToolInput(message: UIMessage | undefined) {
  const part = (message as AnyMessage | undefined)?.parts.find(
    candidate => candidate.type === 'dynamic-tool' || candidate.type?.startsWith('tool-'),
  );
  return part?.input as { nested?: { value?: string } } | undefined;
}

function findData(message: UIMessage | undefined) {
  const part = (message as AnyMessage | undefined)?.parts.find(candidate =>
    candidate.type?.startsWith('data-'),
  );
  return part?.data as { nested?: { value?: string } } | undefined;
}

describe('React Chat callback ownership boundaries', () => {
  it('keeps the already-published tool input snapshot stable when onToolCall mutates its callback object', async () => {
    const transport = new ManualTransport();
    let firstPublishedAssistant: UIMessage | undefined;

    const chat = new Chat({
      id: 'tool-callback-ownership',
      generateId: () => 'generated-user',
      transport,
      onToolCall: ({ toolCall }) => {
        const input = (toolCall as any).input as { nested: { value: string } };
        input.nested.value = 'mutated-by-callback';
      },
    });

    const unsubscribe = chat['~registerMessagesCallback'](() => {
      const assistant = chat.messages.find(message => message.role === 'assistant');
      if (
        firstPublishedAssistant == null &&
        findToolInput(assistant)?.nested?.value === 'before-callback'
      ) {
        firstPublishedAssistant = assistant;
      }
    });

    const request = chat.sendMessage({ text: 'go' });
    await tick();

    transport.emit({ type: 'start', messageId: 'assistant-1' });
    transport.emit({ type: 'start-step' });
    transport.emit({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'demo',
      input: { nested: { value: 'before-callback' } },
      dynamic: true,
    });
    await tick();

    expect(firstPublishedAssistant).toBeDefined();
    expect(findToolInput(firstPublishedAssistant)?.nested?.value).toBe(
      'before-callback',
    );

    transport.emit({ type: 'finish-step' });
    transport.emit({ type: 'finish' });
    transport.close();
    await request;
    unsubscribe();

    // A publication is an immutable snapshot. Mutating the callback argument
    // after the write must not retroactively change that earlier snapshot.
    expect(findToolInput(firstPublishedAssistant)?.nested?.value).toBe(
      'before-callback',
    );
  });

  it('keeps an already-published data snapshot stable when retained onData data is mutated later', async () => {
    const transport = new ManualTransport();
    let retainedData: { nested: { value: string } } | undefined;
    let firstPublishedAssistant: UIMessage | undefined;

    const chat = new Chat<any>({
      id: 'data-callback-ownership',
      generateId: () => 'generated-user',
      transport: transport as ChatTransport<any>,
      onData: dataPart => {
        retainedData = (dataPart as any).data;
      },
    });

    const unsubscribe = chat['~registerMessagesCallback'](() => {
      const assistant = chat.messages.find(message => message.role === 'assistant');
      if (
        firstPublishedAssistant == null &&
        findData(assistant)?.nested?.value === 'before-retained-mutation'
      ) {
        firstPublishedAssistant = assistant;
      }
    });

    const request = chat.sendMessage({ text: 'go' });
    await tick();

    transport.emit({ type: 'start', messageId: 'assistant-1' });
    transport.emit({ type: 'start-step' });
    transport.emit({
      type: 'data-demo',
      id: 'data-1',
      data: { nested: { value: 'before-retained-mutation' } },
    } as UIMessageChunk);
    await tick();

    expect(retainedData).toBeDefined();
    expect(firstPublishedAssistant).toBeDefined();

    retainedData!.nested.value = 'mutated-after-publication';

    expect(findData(firstPublishedAssistant)?.nested?.value).toBe(
      'before-retained-mutation',
    );

    transport.emit({ type: 'finish-step' });
    transport.emit({ type: 'finish' });
    transport.close();
    await request;
    unsubscribe();
  });
});
