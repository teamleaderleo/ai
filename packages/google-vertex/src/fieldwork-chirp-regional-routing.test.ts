import { describe, expect, it } from 'vitest';
import { createGoogleVertex } from './google-vertex-provider-base';

const GLOBAL_TTS_URL =
  'https://texttospeech.googleapis.com/v1/text:synthesize';

function createCapturingFetch(onUrl: (url: string) => void) {
  return async (input: RequestInfo | URL) => {
    onUrl(input.toString());
    return new Response(JSON.stringify({ audioContent: 'AQIDBAUGBwg=' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('Fieldwork: Google Vertex Chirp regional routing', () => {
  for (const location of ['eu', 'us'] as const) {
    it(
      `routes Chirp through the global Cloud TTS endpoint even when provider location is ${location}`,
      async () => {
        let requestUrl: string | undefined;
        const provider = createGoogleVertex({
          project: 'fieldwork-project',
          location,
          fetch: createCapturingFetch(url => {
            requestUrl = url;
          }),
        });

        await provider.speech('chirp-3-hd').doGenerate({ text: 'hello' });

        expect(requestUrl).toBe(GLOBAL_TTS_URL);
      },
    );
  }

  it('uses the global Cloud TTS endpoint for global location', async () => {
    let requestUrl: string | undefined;
    const provider = createGoogleVertex({
      project: 'fieldwork-project',
      location: 'global',
      fetch: createCapturingFetch(url => {
        requestUrl = url;
      }),
    });

    await provider.speech('chirp-3-hd').doGenerate({ text: 'hello' });

    expect(requestUrl).toBe(GLOBAL_TTS_URL);
  });

  it('keeps Cloud TTS routing independent from the Vertex baseURL option', async () => {
    let requestUrl: string | undefined;
    const provider = createGoogleVertex({
      project: 'fieldwork-project',
      location: 'eu',
      baseURL: 'https://vertex-proxy.example.test/v1',
      fetch: createCapturingFetch(url => {
        requestUrl = url;
      }),
    });

    await provider.speech('chirp-3-hd').doGenerate({ text: 'hello' });

    expect(requestUrl).toBe(GLOBAL_TTS_URL);
  });
});
