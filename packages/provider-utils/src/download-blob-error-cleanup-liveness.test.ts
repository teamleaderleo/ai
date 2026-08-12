import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelResponseBody } from './cancel-response-body';
import { downloadBlob } from './download-blob';
import { fetchWithValidatedRedirects } from './fetch-with-validated-redirects';

vi.mock('./cancel-response-body', () => ({
  cancelResponseBody: vi.fn(),
}));

vi.mock('./fetch-with-validated-redirects', () => ({
  fetchWithValidatedRedirects: vi.fn(),
}));

const mockedCancelResponseBody = vi.mocked(cancelResponseBody);
const mockedFetchWithValidatedRedirects = vi.mocked(
  fetchWithValidatedRedirects,
);

describe('downloadBlob error cleanup liveness', () => {
  beforeEach(() => {
    mockedCancelResponseBody.mockReset();
    mockedFetchWithValidatedRedirects.mockReset();
  });

  it('rejects a non-OK response without waiting for cleanup to settle', async () => {
    const response = new Response('failure body', {
      status: 500,
      statusText: 'Internal Server Error',
    });
    const pendingCleanup = new Promise<void>(() => {});

    mockedFetchWithValidatedRedirects.mockResolvedValue(response);
    mockedCancelResponseBody.mockReturnValue(pendingCleanup);

    await expect(
      downloadBlob('https://example.test/file'),
    ).rejects.toMatchObject({
      name: 'AI_DownloadError',
      statusCode: 500,
      statusText: 'Internal Server Error',
    });

    expect(mockedCancelResponseBody).toHaveBeenCalledOnce();
    expect(mockedCancelResponseBody).toHaveBeenCalledWith(response);
  });
});
