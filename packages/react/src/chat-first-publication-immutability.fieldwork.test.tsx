import {
  createTestServer,
  TestResponseController,
} from '@ai-sdk/test-server/with-vitest';
import { mockId } from '@ai-sdk/provider-utils/test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DefaultChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chat } from './chat.react';
import { useChat } from './use-chat';

function formatChunk(part: UIMessageChunk) {
  return `data: ${JSON.stringify(part)}\n\n`;
}

function assistantText(messages: UIMessage[]): string | undefined {
  const assistant = messages[1];
  const part = assistant?.parts[0];
  return part?.type === 'text' ? part.text : undefined;
}

const server = createTestServer({
  '/api/chat': {},
});

let renderedSnapshots: UIMessage[][] = [];

function TestChat() {
  const { messages, sendMessage } = useChat({
    generateId: mockId(),
  });

  useEffect(() => {
    renderedSnapshots.push(messages);
  }, [messages]);

  return (
    <button
      data-testid="send"
      onClick={() =>
        sendMessage({ parts: [{ type: 'text', text: 'hi' }] })
      }
    />
  );
}

describe('Fieldwork: first assistant publication is immutable', () => {
  beforeEach(() => {
    renderedSnapshots = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('does not mutate an earlier useChat snapshot after a later text delta', async () => {
    const controller = new TestResponseController();
    server.urls['/api/chat'].response = {
      type: 'controlled-stream',
      controller,
    };

    render(<TestChat />);
    await userEvent.click(screen.getByTestId('send'));

    controller.write(formatChunk({ type: 'text-start', id: '0' }));

    await waitFor(() => {
      expect(
        renderedSnapshots.some(
          messages => messages.length === 2 && assistantText(messages) === '',
        ),
      ).toBe(true);
    });

    const firstAssistantSnapshot = renderedSnapshots.find(
      messages => messages.length === 2 && assistantText(messages) === '',
    )!;

    controller.write(
      formatChunk({ type: 'text-delta', id: '0', delta: 'Hello' }),
    );

    await waitFor(() => {
      expect(
        renderedSnapshots.some(messages => assistantText(messages) === 'Hello'),
      ).toBe(true);
    });

    controller.write(formatChunk({ type: 'text-end', id: '0' }));
    controller.close();

    await waitFor(() => {
      expect(assistantText(renderedSnapshots.at(-1) ?? [])).toBe('Hello');
    });

    expect(assistantText(firstAssistantSnapshot)).toBe('');
  });

  it('does not mutate an earlier plain Chat subscriber snapshot', async () => {
    const controller = new TestResponseController();
    server.urls['/api/chat'].response = {
      type: 'controlled-stream',
      controller,
    };

    const chat = new Chat({
      generateId: mockId(),
      transport: new DefaultChatTransport(),
    });
    const subscriberSnapshots: UIMessage[][] = [];
    const unsubscribe = chat['~registerMessagesCallback'](() => {
      subscriberSnapshots.push(chat.messages);
    });

    const sendPromise = chat.sendMessage({
      parts: [{ type: 'text', text: 'hi' }],
    });

    controller.write(formatChunk({ type: 'text-start', id: '0' }));

    await waitFor(() => {
      expect(
        subscriberSnapshots.some(
          messages => messages.length === 2 && assistantText(messages) === '',
        ),
      ).toBe(true);
    });

    const firstAssistantSnapshot = subscriberSnapshots.find(
      messages => messages.length === 2 && assistantText(messages) === '',
    )!;

    controller.write(
      formatChunk({ type: 'text-delta', id: '0', delta: 'Hello' }),
    );

    await waitFor(() => {
      expect(assistantText(chat.messages)).toBe('Hello');
    });

    controller.write(formatChunk({ type: 'text-end', id: '0' }));
    controller.close();
    await sendPromise;
    unsubscribe();

    expect(assistantText(firstAssistantSnapshot)).toBe('');
  });
});
