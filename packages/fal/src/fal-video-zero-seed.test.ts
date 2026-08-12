import { describe, expect, it } from 'vitest';
import { FalVideoModel } from './fal-video-model';

const prompt = 'A rocket launching into space';

function createModel(onRequest: (body: unknown) => void) {
  return new FalVideoModel('fal-ai/wan/v2.7/text-to-video', {
    provider: 'fal.video',
    url: ({ path }) => path,
    headers: () => ({ Authorization: 'Key test-api-key' }),
    fetch: async (_url, init) => {
      if (init?.body != null) {
        onRequest(JSON.parse(init.body as string));
      }

      return new Response(
        JSON.stringify({
          request_id: 'request-0',
          response_url: 'https://queue.fal.run/requests/request-0',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  });
}

describe('Fieldwork #872: Fal video zero seed', () => {
  it('preserves seed 0 in the provider request', async () => {
    let capturedBody: unknown;
    const model = createModel(body => {
      capturedBody = body;
    });

    await model.doStart({
      prompt,
      n: 1,
      image: undefined,
      frameImages: undefined,
      inputReferences: undefined,
      aspectRatio: undefined,
      resolution: undefined,
      duration: undefined,
      fps: undefined,
      generateAudio: undefined,
      seed: 0,
      providerOptions: {},
    });

    expect(capturedBody).toMatchObject({
      prompt,
      seed: 0,
    });
  });
});
