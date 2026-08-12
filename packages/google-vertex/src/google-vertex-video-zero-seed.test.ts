import { describe, expect, it } from 'vitest';
import { GoogleVertexVideoModel } from './google-vertex-video-model';

const prompt = 'A rocket launching into space';

function createModel(onRequest: (body: unknown) => void) {
  return new GoogleVertexVideoModel('veo-3.1-generate-preview', {
    provider: 'google-vertex.video',
    baseURL:
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test/locations/us-central1/publishers/google',
    headers: { Authorization: 'Bearer test-token' },
    fetch: async (_url, init) => {
      if (init?.body != null) {
        onRequest(JSON.parse(init.body as string));
      }

      return new Response(JSON.stringify({ name: 'operations/operation-0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

describe('Fieldwork #872: Google Vertex video zero seed', () => {
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
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        seed: 0,
      },
    });
  });
});
