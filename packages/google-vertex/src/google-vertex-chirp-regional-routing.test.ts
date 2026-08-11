import { describe, expect, it } from 'vitest';
import { createGoogleVertex } from './google-vertex-provider-base';

function createCapturingFetch(onUrl: (url: string) => void) {
  return async (input: RequestInfo | URL) => {
    onUrl(input.toString());
    return new Response(JSON.stringify({ audioContent: 'AQIDBAUGBwg=' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function requestUrlFor({
  location,
  baseURL,
}: {
  location: string;
  baseURL?: string;
}) {
  let requestUrl: string | undefined;
  const provider = createGoogleVertex({
    project: 'fieldwork-project',
    location,
    baseURL,
    fetch: createCapturingFetch(url => {
      requestUrl = url;
    }),
  });

  await provider.speech('chirp-3-hd').doGenerate({ text: 'hello' });
  return requestUrl;
}

describe('Google Vertex Chirp Cloud TTS routing', () => {
  it.each([
    ['eu', 'https://eu-texttospeech.googleapis.com/v1/text:synthesize'],
    ['us', 'https://us-texttospeech.googleapis.com/v1/text:synthesize'],
    [
      'europe-west2',
      'https://europe-west2-texttospeech.googleapis.com/v1/text:synthesize',
    ],
    [
      'asia-southeast1',
      'https://asia-southeast1-texttospeech.googleapis.com/v1/text:synthesize',
    ],
    [
      'asia-northeast1',
      'https://asia-northeast1-texttospeech.googleapis.com/v1/text:synthesize',
    ],
  ])('uses the supported %s Cloud TTS endpoint', async (location, expected) => {
    await expect(requestUrlFor({ location })).resolves.toBe(expected);
  });

  it('keeps global on the global Cloud TTS endpoint', async () => {
    await expect(requestUrlFor({ location: 'global' })).resolves.toBe(
      'https://texttospeech.googleapis.com/v1/text:synthesize',
    );
  });

  it('preserves global fallback for a Vertex location without Chirp regional support', async () => {
    await expect(requestUrlFor({ location: 'us-central1' })).resolves.toBe(
      'https://texttospeech.googleapis.com/v1/text:synthesize',
    );
  });

  it('does not treat the Vertex baseURL as the Cloud TTS endpoint', async () => {
    await expect(
      requestUrlFor({
        location: 'eu',
        baseURL: 'https://vertex-proxy.example.test/v1',
      }),
    ).resolves.toBe(
      'https://eu-texttospeech.googleapis.com/v1/text:synthesize',
    );
  });
});
