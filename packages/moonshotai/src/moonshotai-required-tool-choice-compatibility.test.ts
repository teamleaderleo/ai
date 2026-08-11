import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMoonshotAI } from './moonshotai-provider';

const url = 'https://api.moonshot.ai/v1/chat/completions';
const server = createTestServer({ [url]: {} });

const provider = createMoonshotAI({ apiKey: 'test-api-key' });

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

describe('Moonshot required tool choice compatibility', () => {
  beforeEach(() => {
    prepareResponse();
  });

  for (const modelId of ['kimi-k2.5', 'kimi-k2.6'] as const) {
    it(`rejects required tool choice locally for ${modelId}`, async () => {
      await expect(
        provider.chatModel(modelId).doGenerate({
          prompt,
          tools,
          toolChoice: { type: 'required' },
        }),
      ).rejects.toBeInstanceOf(UnsupportedFunctionalityError);

      expect(server.calls).toHaveLength(0);
    });
  }

  it('preserves auto tool choice for kimi-k2.6', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'auto' },
    });

    expect((await server.calls[0].requestBodyJson).tool_choice).toBe('auto');
  });

  it('preserves none tool choice for kimi-k2.6', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'none' },
    });

    expect((await server.calls[0].requestBodyJson).tool_choice).toBe('none');
  });

  it('leaves kimi-k3 required tool choice unchanged', async () => {
    await provider.chatModel('kimi-k3').doGenerate({
      prompt,
      tools,
      toolChoice: { type: 'required' },
    });

    expect((await server.calls[0].requestBodyJson).tool_choice).toBe('required');
  });

  it('does not reject required when there are no usable tools', async () => {
    await provider.chatModel('kimi-k2.6').doGenerate({
      prompt,
      tools: [],
      toolChoice: { type: 'required' },
    });

    expect(await server.calls[0].requestBodyJson).not.toHaveProperty(
      'tool_choice',
    );
  });
});
