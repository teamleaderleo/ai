import { describe, expect, it } from 'vitest';
import { XaiVideoModel } from './xai-video-model';

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

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function createSlowCompletedPollModel() {
  return new XaiVideoModel('grok-imagine-video', {
    provider: 'xai.video',
    baseURL: 'https://api.example.com',
    headers: () => ({ 'api-key': 'test-key' }),
    fetch: async url => {
      const value = url.toString();

      if (value.endsWith('/videos/generations')) {
        return Response.json({ request_id: 'req-deadline-test' });
      }

      if (value.endsWith('/videos/req-deadline-test')) {
        // Deliberately ignore the request signal. FetchFunction is injectable,
        // and the deadline still has to own terminal publication when a custom
        // transport completes after the configured timeout.
        await sleep(30);
        return Response.json({
          status: 'done',
          video: {
            url: 'https://example.com/video.mp4',
            respect_moderation: true,
          },
        });
      }

      return new Response('Not found', { status: 404 });
    },
  });
}

describe('XaiVideoModel polling deadline', () => {
  it('does not accept a completed status request after pollTimeoutMs', async () => {
    const model = createSlowCompletedPollModel();

    await expect(
      model.doGenerate({
        ...defaultOptions,
        providerOptions: {
          xai: {
            pollIntervalMs: 1,
            pollTimeoutMs: 5,
          },
        },
      }),
    ).rejects.toMatchObject({
      name: 'XAI_VIDEO_GENERATION_TIMEOUT',
    });
  });
});
