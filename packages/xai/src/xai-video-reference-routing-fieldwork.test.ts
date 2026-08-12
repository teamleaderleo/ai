import { describe, expect, it } from 'vitest';
import { XaiVideoModel } from './xai-video-model';

const defaultOptions = {
  prompt: 'A person walking through a city',
  n: 1,
  image: undefined,
  frameImages: undefined,
  inputReferences: undefined,
  aspectRatio: undefined,
  resolution: undefined,
  duration: undefined,
  fps: undefined,
  generateAudio: undefined,
  seed: undefined,
  providerOptions: {},
} as const;

function createCapturingModel(modelId = 'grok-imagine-video-1.5') {
  let requestBody: Record<string, unknown> | undefined;

  const model = new XaiVideoModel(modelId, {
    provider: 'xai.video',
    baseURL: 'https://api.example.test',
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ request_id: 'req-fieldwork' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  return {
    model,
    getRequestBody: () => requestBody,
  };
}

describe('Fieldwork #863: xAI video reference routing', () => {
  it('sends reference-to-video with grok-imagine-video-1.5', async () => {
    const { model, getRequestBody } = createCapturingModel();

    await model.doStart({
      ...defaultOptions,
      providerOptions: {
        xai: {
          mode: 'reference-to-video',
          referenceImageUrls: ['https://example.com/ref.jpg'],
          referenceVoiceIds: ['eve'],
        },
      },
    });

    expect(getRequestBody()).toMatchObject({
      model: 'grok-imagine-video-1.5',
      reference_images: [{ url: 'https://example.com/ref.jpg' }],
      reference_audios: [{ voice_id: 'eve' }],
    });
  });

  it('lets unusable first-class references shadow valid legacy reference images', async () => {
    const { model, getRequestBody } = createCapturingModel('grok-imagine-video');

    const result = await model.doStart({
      ...defaultOptions,
      inputReferences: [
        {
          type: 'url',
          url: 'https://example.com/unrelated.mp4',
          mediaType: 'video/mp4',
        },
      ],
      providerOptions: {
        xai: {
          referenceImageUrls: ['https://example.com/usable.jpg'],
        },
      },
    });

    expect(getRequestBody()).not.toHaveProperty('reference_images');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'unsupported',
          feature: 'inputReferences',
        }),
        expect.objectContaining({
          type: 'unsupported',
          feature: 'referenceImages',
        }),
      ]),
    );
  });

  it('keeps legacy reference images when no first-class list takes precedence', async () => {
    const { model, getRequestBody } = createCapturingModel('grok-imagine-video');

    await model.doStart({
      ...defaultOptions,
      providerOptions: {
        xai: {
          referenceImageUrls: ['https://example.com/usable.jpg'],
        },
      },
    });

    expect(getRequestBody()).toMatchObject({
      reference_images: [{ url: 'https://example.com/usable.jpg' }],
    });
  });
});
