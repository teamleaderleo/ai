import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it, vi } from 'vitest';
import { GoogleVertexCloudTTSSpeechModel } from './google-vertex-cloud-tts-speech-model';
import { createGoogleVertex } from './google-vertex-provider-base';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const GLOBAL_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const EU_URL = 'https://eu-texttospeech.googleapis.com/v1/text:synthesize';
const US_URL = 'https://us-texttospeech.googleapis.com/v1/text:synthesize';

const server = createTestServer({
  [GLOBAL_URL]: {},
  [EU_URL]: {},
  [US_URL]: {},
});

function prepareResponse(url: string) {
  server.urls[url].response = {
    type: 'json-value',
    body: { audioContent: 'AQID' },
  };
}

function createSpeechModel(location: string) {
  return createGoogleVertex({
    project: 'test-project',
    location,
  }).speech('chirp-3-hd');
}

describe('Chirp 3 HD regional endpoint routing', () => {
  it('uses the EU multi-region Cloud TTS endpoint for location eu', async () => {
    prepareResponse(EU_URL);

    await createSpeechModel('eu').doGenerate({ text: 'Hello' });

    expect(server.calls[0].requestUrl).toBe(EU_URL);
  });

  it('uses the US multi-region Cloud TTS endpoint for location us', async () => {
    prepareResponse(US_URL);

    await createSpeechModel('us').doGenerate({ text: 'Hello' });

    expect(server.calls[0].requestUrl).toBe(US_URL);
  });

  it('keeps ordinary Vertex regions on the global Cloud TTS endpoint', async () => {
    prepareResponse(GLOBAL_URL);

    await createSpeechModel('us-central1').doGenerate({ text: 'Hello' });

    expect(server.calls[0].requestUrl).toBe(GLOBAL_URL);
  });

  it('keeps older model configs without location on the global endpoint', async () => {
    prepareResponse(GLOBAL_URL);

    const model = new GoogleVertexCloudTTSSpeechModel('chirp-3-hd', {
      provider: 'google.vertex.speech',
      headers: () => ({}),
    });

    await model.doGenerate({ text: 'Hello' });

    expect(server.calls[0].requestUrl).toBe(GLOBAL_URL);
  });
});
