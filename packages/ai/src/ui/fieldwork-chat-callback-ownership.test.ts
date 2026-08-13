import { mockId } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
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

  snapshot = <T>(value: T): T => value;
}

class TestChat extends AbstractChat<UIMessage> {
  constructor(init: ChatInit<UIMessage>) {
    super({
      ...init,
      state: new TestChatState(init.messages ?? []),
    });
  }
}

describe('Fieldwork #546: chat callback failure ownership', () => {
  it('currently lets a throwing onError skip normal request error publication', async () => {
    const transportError = new Error('transport failed');
    const callbackError = new Error('onError failed');
    const onFinish = vi.fn();

    const chat = new TestChat({
      id: 'fieldwork-546-send',
      generateId: mockId(),
      transport: {
        sendMessages: async () => {
          throw transportError;
        },
        reconnectToStream: async () => null,
      },
      onError: error => {
        expect(error).toBe(transportError);
        throw callbackError;
      },
      onFinish,
    });

    await expect(chat.sendMessage({ text: 'hello' })).rejects.toBe(
      callbackError,
    );

    expect(chat.status).toBe('submitted');
    expect(chat.error).toBeUndefined();
    expect((chat as any).activeResponse).toBeUndefined();
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        isAbort: false,
        isError: true,
      }),
    );
  });

  it('currently lets a throwing reconnect onError escape before resume ownership is cleared', async () => {
    const reconnectError = new Error('reconnect failed');
    const callbackError = new Error('onError failed');
    const onFinish = vi.fn();

    const chat = new TestChat({
      id: 'fieldwork-546-resume',
      generateId: mockId(),
      transport: {
        sendMessages: async () => {
          throw new Error('sendMessages should not run');
        },
        reconnectToStream: async () => {
          throw reconnectError;
        },
      },
      onError: error => {
        expect(error).toBe(reconnectError);
        throw callbackError;
      },
      onFinish,
    });

    await expect(chat.resumeStream()).rejects.toBe(callbackError);

    expect(chat.status).toBe('ready');
    expect(chat.error).toBeUndefined();
    expect((chat as any).activeResumeRequest).toBeDefined();
    expect(onFinish).not.toHaveBeenCalled();
  });
});
