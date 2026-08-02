import { describe, expect, it } from 'vitest';
import { GoogleVideoModel } from './google-video-model';

const defaultOptions = {
  prompt: 'A short test video',
  n: 1,
  image: undefined,
  frameImages: undefined,
  inputReferences: undefined,
  aspectRatio: undefined,
  resolution: undefined,
  duration: undefined,
  fps: undefined,
  seed: undefined,
  generateAudio: undefined,
  headers: undefined,
  abortSignal: undefined,
} as const;

function createCompletesOnFirstPollModel() {
  return new GoogleVideoModel('veo-3.1-generate-preview', {
    provider: 'google.generative-ai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    headers: () => ({ 'x-goog-api-key': 'test-api-key' }),
    fetch: async url => {
      const value = url.toString();

      if (value.includes(':predictLongRunning')) {
        return Response.json({
          name: 'operations/deadline-test',
          done: false,
        });
      }

      if (value.includes('operations/deadline-test')) {
        return Response.json({
          name: 'operations/deadline-test',
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    uri: 'https://example.com/video.mp4',
                  },
                },
              ],
            },
          },
        });
      }

      return new Response('Not found', { status: 404 });
    },
  });
}

describe('GoogleVideoModel polling deadline', () => {
  it('does not accept a completed poll after pollTimeoutMs has elapsed', async () => {
    const model = createCompletesOnFirstPollModel();

    await expect(
      model.doGenerate({
        ...defaultOptions,
        providerOptions: {
          google: {
            pollIntervalMs: 30,
            pollTimeoutMs: 5,
          },
        },
      }),
    ).rejects.toMatchObject({
      name: 'GOOGLE_VIDEO_GENERATION_TIMEOUT',
    });
  });
});
