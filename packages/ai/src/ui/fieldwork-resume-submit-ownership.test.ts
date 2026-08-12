import { mockId } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import type { UIMessageChunk } from '../ui-message-stream/ui-message-chunks';
import {
  AbstractChat,
  type ChatInit,
  type ChatState,
  type ChatStatus,
} from './chat';
import type { UIMessage } from './ui-messages';

class TestChatState<
  UI_MESSAGE extends UIMessage,
> implements ChatState<UI_MESSAGE> {
  status: ChatStatus = 'ready';
  messages: UI_MESSAGE[];
  error: Error | undefined = undefined;

  constructor(initialMessages: UI_MESSAGE[] = []) {
    this.messages = initialMessages;
  }

  pushMessage = (message: UI_MESSAGE) => {
    this.messages = this.messages.concat(message);
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
  };

  replaceMessage = (index: number, message: UI_MESSAGE) => {
    this.messages = [
      ...this.messages.slice(0, index),
      message,
      ...this.messages.slice(index + 1),
    ];
  };

  snapshot = <T>(value: T): T => structuredClone(value);
}

class TestChat extends AbstractChat<UIMessage> {
  constructor(init: ChatInit<UIMessage>) {
    super({
      ...init,
      state: new TestChatState(init.messages ?? []),
    });
  }
}

function textParts(messages: UIMessage[]) {
  return messages.map(message => ({
    role: message.role,
    text: message.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join(''),
  }));
}

describe('Fieldwork #545: resume and submit request ownership', () => {
  it('characterizes whether an older resumed stream can mutate chat after a newer submission settles', async () => {
    let resumeController!: ReadableStreamDefaultController<UIMessageChunk>;
    let reconnectAbortSignal: AbortSignal | undefined;

    const resumeStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        resumeController = controller;
        controller.enqueue({ type: 'start', messageId: 'resumed-assistant' });
        controller.enqueue({ type: 'start-step' });
        controller.enqueue({ type: 'text-start', id: 'resume-text' });
        controller.enqueue({
          type: 'text-delta',
          id: 'resume-text',
          delta: 'resumed',
        });
      },
    });

    const submitStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: 'start', messageId: 'submitted-assistant' });
        controller.enqueue({ type: 'start-step' });
        controller.enqueue({ type: 'text-start', id: 'submit-text' });
        controller.enqueue({
          type: 'text-delta',
          id: 'submit-text',
          delta: 'submitted',
        });
        controller.enqueue({ type: 'text-end', id: 'submit-text' });
        controller.enqueue({ type: 'finish-step' });
        controller.enqueue({ type: 'finish', finishReason: 'stop' });
        controller.close();
      },
    });

    const chat = new TestChat({
      id: '123',
      generateId: mockId(),
      transport: {
        reconnectToStream: async options => {
          reconnectAbortSignal = options.abortSignal;
          return resumeStream;
        },
        sendMessages: async () => submitStream,
      },
      onFinish: () => {},
    });

    const resumePromise = chat.resumeStream();

    await vi.waitFor(() => {
      expect(textParts(chat.messages)).toEqual([
        { role: 'assistant', text: 'resumed' },
      ]);
    });

    await chat.sendMessage({ text: 'new turn' });

    expect(reconnectAbortSignal?.aborted).toBe(false);
    expect(textParts(chat.messages)).toEqual([
      { role: 'assistant', text: 'resumed' },
      { role: 'user', text: 'new turn' },
      { role: 'assistant', text: 'submitted' },
    ]);

    const messagesAfterNewerSubmit = structuredClone(chat.messages);

    resumeController.enqueue({ type: 'text-end', id: 'resume-text' });
    resumeController.enqueue({ type: 'finish-step' });
    resumeController.enqueue({ type: 'finish', finishReason: 'stop' });
    resumeController.close();
    await resumePromise;

    expect(chat.messages).not.toEqual(messagesAfterNewerSubmit);
    expect(textParts(chat.messages)).toEqual([
      { role: 'assistant', text: 'resumed' },
      { role: 'user', text: 'new turn' },
      { role: 'assistant', text: 'submitted' },
      { role: 'assistant', text: 'resumed' },
    ]);
  });
});