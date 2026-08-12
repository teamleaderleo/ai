import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadError } from './download-error';
import { downloadBlob } from './download-blob';
import { fetchWithValidatedRedirects } from './fetch-with-validated-redirects';

vi.mock('./fetch-with-validated-redirects', () => ({
  fetchWithValidatedRedirects: vi.fn(),
}));

const mockedFetchWithValidatedRedirects = vi.mocked(
  fetchWithValidatedRedirects,
);

function createFiniteErrorResponse() {
  return new Response('failure body', {
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'content-type': 'text/plain' },
  });
}

describe('Fieldwork #882: cloned non-OK download response cleanup', () => {
  beforeEach(() => {
    mockedFetchWithValidatedRedirects.mockReset();
  });

  it('keeps downloadBlob pending until the retained tee sibling is cancelled', async () => {
    const response = createFiniteErrorResponse();
    const retainedClone = response.clone();
    mockedFetchWithValidatedRedirects.mockResolvedValue(response);

    let settled = false;
    const result = downloadBlob('https://example.test/file').finally(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);

    await retainedClone.body!.cancel();

    await expect(result).rejects.toMatchObject({
      name: DownloadError.name,
      statusCode: 500,
      statusText: 'Internal Server Error',
    });
    expect(settled).toBe(true);
  });

  it('publishes the same HTTP failure promptly when the response is not cloned', async () => {
    mockedFetchWithValidatedRedirects.mockResolvedValue(
      createFiniteErrorResponse(),
    );

    await expect(
      downloadBlob('https://example.test/file'),
    ).rejects.toMatchObject({
      name: DownloadError.name,
      statusCode: 500,
      statusText: 'Internal Server Error',
    });
  });
});
