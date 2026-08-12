import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { Chat } from './chat.react';

describe('React Chat caller-owned payload snapshots', () => {
  it('detaches addToolOutput payloads from caller mutation after publication', async () => {
    const output = {
      nested: {
        value: 'before',
      },
    };

    const chat = new Chat<UIMessage>({
      id: 'chat-id',
      messages: [
        {
          id: 'assistant-message',
          role: 'assistant',
          parts: [
            {
              type: 'tool-demo',
              toolCallId: 'tool-call-1',
              state: 'input-available',
              input: {},
            },
          ],
        },
      ],
    });

    let publications = 0;
    const unsubscribe = chat['~registerMessagesCallback'](() => {
      publications++;
    });

    try {
      await chat.addToolOutput({
        tool: 'demo',
        toolCallId: 'tool-call-1',
        output,
      });

      expect(publications).toBe(1);

      const publishedPart = chat.messages[0].parts.find(
        part => 'toolCallId' in part && part.toolCallId === 'tool-call-1',
      );
      expect(publishedPart).toBeDefined();
      expect(publishedPart && 'output' in publishedPart).toBe(true);

      const publishedOutput =
        publishedPart && 'output' in publishedPart
          ? (publishedPart.output as typeof output)
          : undefined;

      expect(publishedOutput).toEqual({ nested: { value: 'before' } });
      expect(publishedOutput).not.toBe(output);

      output.nested.value = 'after';

      expect(publishedOutput).toEqual({ nested: { value: 'before' } });
      expect(publications).toBe(1);
    } finally {
      unsubscribe();
    }
  });
});
