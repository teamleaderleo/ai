import { InvalidArgumentError } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { XaiVideoModel } from './xai-video-model';

const defaultOptions = {
  prompt: 'A character walks through a city',
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

function createCapturingModel() {
  let requestBody: Record<string, unknown> | undefined;

  const model = new XaiVideoModel('grok-imagine-video', {
    provider: 'xai.video',
    baseURL: 'https://api.example.test',
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ request_id: 'req-file-id' }), {
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

describe('xAI video Files API reference inputs', () => {
  it('auto-selects reference-to-video for provider file IDs', async () => {
    const { model, getRequestBody } = createCapturingModel();

    await model.doStart({
      ...defaultOptions,
      providerOptions: {
        xai: {
          referenceImageFileIds: ['file_subject'],
        },
      },
    });

    expect(getRequestBody()).toMatchObject({
      reference_images: [{ file_id: 'file_subject' }],
    });
  });

  it('combines file IDs before legacy URL references deterministically', async () => {
    const { model, getRequestBody } = createCapturingModel();

    await model.doStart({
      ...defaultOptions,
      providerOptions: {
        xai: {
          mode: 'reference-to-video',
          referenceImageFileIds: ['file_subject', 'file_outfit'],
          referenceImageUrls: ['https://example.com/background.jpg'],
        },
      },
    });

    expect(getRequestBody()).toMatchObject({
      reference_images: [
        { file_id: 'file_subject' },
        { file_id: 'file_outfit' },
        { url: 'https://example.com/background.jpg' },
      ],
    });
  });

  it('keeps first-class inputReferences authoritative over provider references', async () => {
    const { model, getRequestBody } = createCapturingModel();

    await model.doStart({
      ...defaultOptions,
      inputReferences: [
        {
          type: 'url',
          url: 'https://example.com/first-class.jpg',
          mediaType: 'image/jpeg',
        },
      ],
      providerOptions: {
        xai: {
          referenceImageFileIds: ['file_provider'],
          referenceImageUrls: ['https://example.com/provider.jpg'],
        },
      },
    });

    expect(getRequestBody()).toMatchObject({
      reference_images: [{ url: 'https://example.com/first-class.jpg' }],
    });
  });

  it('rejects more than seven combined provider reference images', async () => {
    const { model } = createCapturingModel();

    await expect(
      model.doStart({
        ...defaultOptions,
        providerOptions: {
          xai: {
            referenceImageFileIds: [
              'file_1',
              'file_2',
              'file_3',
              'file_4',
            ],
            referenceImageUrls: [
              'https://example.com/1.jpg',
              'https://example.com/2.jpg',
              'https://example.com/3.jpg',
              'https://example.com/4.jpg',
            ],
          },
        },
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });
});
