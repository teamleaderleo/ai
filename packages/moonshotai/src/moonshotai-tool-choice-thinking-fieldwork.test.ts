import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMoonshotAI } from './moonshotai-provider';

const provider = createMoonshotAI({ apiKey: 'test-api-key' });

const url = 'https://api.moonshot.ai/v1/chat/completions';
const server = createTestServer({ [url]: {} });

const prompt = [
  { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
];

const tools = [
  {
    type: 'function' as const,
    name: 'weather',
    description: 'Get the weather',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

function prepareResponse() {
  server.urls[url].response = {
    type: 'json-value',
    body: JSON.parse(
      fs.readFileSync('src/__fixtures__/moonshotai-text.json', 'utf8'),
    ),
  };
}

describe('Fieldwork #856: Moonshot hard tool choice with default thinking', () => {
  beforeEach(() => {
    prepareResponse();
  });

  it('sends required tool choice without overriding K2.6 default thinking', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'required' },
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.tool_choice).toBe('required');
    expect(body).not.toHaveProperty('thinking');
  });

  it('preserves the caller-owned escape path that disables thinking explicitly', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'required' },
      providerOptions: {
        moonshotai: {
          thinking: { type: 'disabled' },
        },
      },
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.tool_choice).toBe('required');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('leaves the documented auto control unchanged', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'auto' },
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.tool_choice).toBe('auto');
    expect(body).not.toHaveProperty('thinking');
  });

  it('also forwards a forced named tool without overriding default thinking', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'tool', toolName: 'weather' },
    });

    const body = await server.calls[0].requestBodyJson;
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'weather' },
    });
    expect(body).not.toHaveProperty('thinking');
  });
});
