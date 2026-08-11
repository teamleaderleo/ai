import { describe, expect, it } from 'vitest';
import { createGoogleVertex } from './google-vertex-provider-base';

const GLOBAL_TTS_URL =
  'https://texttospeech.googleapis.com/v1/text:synthesize';

describe('Fieldwork: Google Vertex Chirp regional routing', () => {
  it('routes Chirp through the global Cloud TTS endpoint even when provider location is eu', async () => {
    let requestUrl: string | undefined;

    const provider = createGoogleVertex({
      project: 'fieldwork-project',
      location: 'eu',
      fetch: async input => {
        requestUrl = input.toString();
        return new Response(
          JSON.stringify({ audioContent: 'AQIDBAUGBwg=' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });

    await provider.speech('chirp-3-hd').doGenerate({ text: 'hello' });

    expect(requestUrl).toBe(GLOBAL_TTS_URL);
  });

  it('also bypasses an explicitly configured Vertex baseURL', async () => {
    let requestUrl: string | undefined;

    const provider = createGoogleVertex({
      project: 'fieldwork-project',
      location: 'eu',
      baseURL: 'https://vertex-proxy.example.test/v1',
      fetch: async input => {
        requestUrl = input.toString();
        return new Response(
          JSON.stringify({ audioContent: 'AQIDBAUGBwg=' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });

    await provider.speech('chirp-3-hd').doGenerate({ text: 'hello' });

    expect(requestUrl).toBe(GLOBAL_TTS_URL);
  });
});
