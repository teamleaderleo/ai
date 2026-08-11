import { describe, expect, it } from 'vitest';
import { fetchWithValidatedRedirects } from './fetch-with-validated-redirects';

function finiteBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

describe('Fieldwork #862: cloned redirect response cancellation', () => {
  it('waits for the retained clone before starting the validated next hop', async () => {
    const urls: string[] = [];
    let retainedClone: Response | undefined;

    const request = fetchWithValidatedRedirects({
      url: 'https://example.com/start',
      fetch: async url => {
        urls.push(url.toString());

        if (urls.length === 1) {
          const response = new Response(finiteBody(), {
            status: 302,
            headers: { location: 'https://example.com/final' },
          });
          retainedClone = response.clone();
          return response;
        }

        return new Response('ok', { status: 200 });
      },
    });

    // Let fetchWithValidatedRedirects receive the first response and enter its
    // awaited response.body.cancel() cleanup. With a retained clone, Web
    // Streams tee cancellation cannot settle yet.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(urls).toEqual(['https://example.com/start']);

    await retainedClone?.body?.cancel();

    const response = await request;
    expect(response.status).toBe(200);
    expect(urls).toEqual([
      'https://example.com/start',
      'https://example.com/final',
    ]);
  });

  it('follows the same redirect immediately when the response is not cloned', async () => {
    const urls: string[] = [];

    const response = await fetchWithValidatedRedirects({
      url: 'https://example.com/start',
      fetch: async url => {
        urls.push(url.toString());
        return urls.length === 1
          ? new Response(finiteBody(), {
              status: 302,
              headers: { location: 'https://example.com/final' },
            })
          : new Response('ok', { status: 200 });
      },
    });

    expect(response.status).toBe(200);
    expect(urls).toEqual([
      'https://example.com/start',
      'https://example.com/final',
    ]);
  });
});
