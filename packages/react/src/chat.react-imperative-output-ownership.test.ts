import { describe, expect, it } from 'vitest';
import type { ChatTransport, UIMessage } from 'ai';
import { Chat } from './chat.react';

const idleTransport: ChatTransport<UIMessage> = {
  async sendMessages() {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  },
  async reconnectToStream() {
    return null;
  },
};

describe('React Chat imperative tool-output ownership', () => {
  it('detaches a caller-owned nested tool output when publishing it', async () => {
    const callerOutput = {
      nested: {
        value: 'before',
      },
    };

    const chat = new Chat<any>({
      id: 'imperative-output-ownership',
      transport: idleTransport as ChatTransport<any>,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'demo',
              toolCallId: 'tool-1',
              state: 'input-available',
              input: { query: 'hello' },
            },
          ],
        },
      ],
    });

    await chat.addToolOutput({
      tool: 'demo',
      toolCallId: 'tool-1',
      output: callerOutput,
    });

    const outputPart = chat.messages[0].parts[0] as {
      output: typeof callerOutput;
    };
    const publishedOutput = outputPart.output;

    // React's current deep replacement snapshot establishes a detached value
    // before consumers receive imperative tool output. A stream-only bounded
    // publication optimization should preserve this ownership property.
    expect(publishedOutput).not.toBe(callerOutput);
    expect(publishedOutput.nested).not.toBe(callerOutput.nested);

    callerOutput.nested.value = 'after';
    expect(publishedOutput.nested.value).toBe('before');
  });
});
