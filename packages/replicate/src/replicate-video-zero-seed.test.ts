import { describe, expect, it } from 'vitest';
import { ReplicateVideoModel } from './replicate-video-model';

const prompt = 'A rocket launching into space';

function createModel(onRequest: (body: unknown) => void) {
  return new ReplicateVideoModel('bytedance/seedance-2.0', {
    provider: 'replicate.video',
    baseURL: 'https://api.replicate.com/v1',
    headers: () => ({ Authorization: 'Bearer test-api-token' }),
    fetch: async (_url, init) => {
      if (init?.body != null) {
        onRequest(JSON.parse(init.body as string));
      }

      return new Response(
        JSON.stringify({
          id: 'prediction-0',
          status: 'starting',
          output: null,
          error: null,
          urls: {
            get: 'https://api.replicate.com/v1/predictions/prediction-0',
          },
          metrics: {},
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  });
}

describe('Fieldwork #872: Replicate video zero seed', () => {
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
      input: {
        prompt,
        seed: 0,
      },
    });
  });
});
