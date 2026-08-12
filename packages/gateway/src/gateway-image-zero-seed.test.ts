import { describe, expect, it } from 'vitest';
import { GatewayImageModel } from './gateway-image-model';

const prompt = 'A rocket launching into space';

function createModel(onRequest: (body: unknown) => void) {
  return new GatewayImageModel('test/image-model', {
    provider: 'gateway.image',
    baseURL: 'https://api.test.com',
    headers: {},
    o11yHeaders: {},
    fetch: async (_url, init) => {
      if (init?.body != null) {
        onRequest(JSON.parse(init.body as string));
      }

      return new Response(
        JSON.stringify({
          images: ['AAAA'],
          warnings: [],
          providerMetadata: {},
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  });
}

describe('Fieldwork #872: Gateway image zero seed', () => {
  it('preserves seed 0 in the Gateway request', async () => {
    let capturedBody: unknown;
    const model = createModel(body => {
      capturedBody = body;
    });

    await model.doGenerate({
      prompt,
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: 0,
      files: undefined,
      mask: undefined,
      providerOptions: {},
    });

    expect(capturedBody).toMatchObject({
      prompt,
      n: 1,
      seed: 0,
    });
  });
});
