import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import React, { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chat } from './chat.react';
import { useChat } from './use-chat';

type AnyPart = UIMessage['parts'][number] & Record<string, any>;

function PartView({ part }: { part: AnyPart }) {
  if (part.type === 'text') {
    return <span data-testid="text-value">{part.text}</span>;
  }

  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    return (
      <span data-testid="tool-value">
        {part.state}|{String(part.approval?.approved)}|
        {part.output?.payload ?? ''}
      </span>
    );
  }

  if (part.type.startsWith('data-')) {
    return <span data-testid="data-value">{part.data?.value ?? ''}</span>;
  }

  return null;
}

function MessageView({ message }: { message: UIMessage }) {
  return (
    <div>
      <span data-testid="metadata-value">
        {(message.metadata as { phase?: string } | undefined)?.phase ?? ''}
      </span>
      {message.parts.map((part, index) => (
        <PartView key={'id' in part && part.id ? part.id : index} part={part as AnyPart} />
      ))}
    </div>
  );
}

class PartAliasingStore {
  private listeners = new Set<() => void>();
  private part: AnyPart = {
    type: 'text',
    text: 'a',
    state: 'streaming',
  };
  private message: UIMessage = {
    id: 'assistant-negative',
    role: 'assistant',
    parts: [this.part],
  };
  private snapshot: UIMessage[] = [this.message];

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  updateText(text: string) {
    // This models the pre-fix ownership problem: a nested part is mutated in
    // place, while the enclosing message and array are republished with fresh
    // identities. React Compiler may memoize PartView against the unchanged
    // part identity and keep stale rendered text.
    this.part.text = text;
    this.message = {
      ...this.message,
      parts: [this.part],
    };
    this.snapshot = [this.message];
    this.listeners.forEach(listener => listener());
  }
}

function AliasingApp({ store }: { store: PartAliasingStore }) {
  const messages = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return <MessageView message={messages[0]} />;
}

function CandidateApp({ chat }: { chat: Chat<UIMessage> }) {
  const { messages } = useChat({ chat });
  const assistant = [...messages]
    .reverse()
    .find(message => message.role === 'assistant');

  return assistant ? <MessageView message={assistant} /> : null;
}

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

async function emit(transport: ManualTransport, chunk: UIMessageChunk) {
  await act(async () => {
    transport.emit(chunk);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
});

describe('React Compiler chat snapshot boundary', () => {
  it('detects the stale nested-part negative control', async () => {
    const store = new PartAliasingStore();
    render(<AliasingApp store={store} />);

    expect(screen.getByTestId('text-value')).toHaveTextContent('a');

    await act(async () => {
      store.updateText('ab');
      await Promise.resolve();
    });

    // This assertion intentionally pins the compiler-sensitive negative
    // control. Without fresh part identity, the compiled PartView remains
    // memoized on the old rendered value even though the mutable object changed.
    expect(screen.getByTestId('text-value')).toHaveTextContent('a');
  });

  it('renders supported useChat transitions with bounded publication snapshots', async () => {
    const transport = new ManualTransport();
    const chat = new Chat({
      id: 'compiler-candidate',
      generateId: (() => {
        let index = 0;
        return () => `generated-${index++}`;
      })(),
      transport,
    });

    render(<CandidateApp chat={chat} />);

    let request: Promise<void> | undefined;
    await act(async () => {
      request = chat.sendMessage({ text: 'go' });
      await Promise.resolve();
    });

    await waitFor(() => expect(transport.controller).toBeDefined());

    await emit(transport, { type: 'start', messageId: 'assistant-1' });
    await emit(transport, { type: 'start-step' });
    await emit(transport, { type: 'text-start', id: 'text-1' });
    await emit(transport, { type: 'text-delta', id: 'text-1', delta: 'a' });
    await waitFor(() =>
      expect(screen.getByTestId('text-value')).toHaveTextContent('a'),
    );

    await emit(transport, { type: 'text-delta', id: 'text-1', delta: 'b' });
    await waitFor(() =>
      expect(screen.getByTestId('text-value')).toHaveTextContent('ab'),
    );

    await emit(transport, {
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'demo',
      input: { query: 'hello' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('tool-value')).toHaveTextContent(
        'input-available|undefined|',
      ),
    );

    await emit(transport, {
      type: 'tool-approval-request',
      toolCallId: 'tool-1',
      approvalId: 'approval-1',
    });
    await waitFor(() =>
      expect(screen.getByTestId('tool-value')).toHaveTextContent(
        'approval-requested|undefined|',
      ),
    );

    await emit(transport, {
      type: 'tool-approval-response',
      approvalId: 'approval-1',
      approved: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId('tool-value')).toHaveTextContent(
        'approval-responded|true|',
      ),
    );

    await emit(transport, {
      type: 'tool-output-available',
      toolCallId: 'tool-1',
      output: { payload: 'large-result' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('tool-value')).toHaveTextContent(
        'output-available|true|large-result',
      ),
    );

    await emit(transport, {
      type: 'data-demo',
      id: 'data-1',
      data: { value: 'one' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('data-value')).toHaveTextContent('one'),
    );

    await emit(transport, {
      type: 'data-demo',
      id: 'data-1',
      data: { value: 'two' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('data-value')).toHaveTextContent('two'),
    );

    await emit(transport, {
      type: 'message-metadata',
      messageMetadata: { phase: 'one' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('metadata-value')).toHaveTextContent('one'),
    );

    await emit(transport, {
      type: 'message-metadata',
      messageMetadata: { phase: 'two' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('metadata-value')).toHaveTextContent('two'),
    );

    await emit(transport, { type: 'text-end', id: 'text-1' });
    await emit(transport, { type: 'finish-step' });
    await emit(transport, { type: 'finish' });

    transport.close();
    await act(async () => {
      await request;
    });
  });
});
