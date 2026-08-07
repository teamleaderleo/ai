import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { useObject } from './use-object';

const server = createTestServer({
  '/api/use-object-async-on-finish': {},
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

it('should route rejected async onFinish callbacks through the request error path', async () => {
  const finishError = new Error('finish failed');
  const onError = vi.fn();

  const TestComponent = () => {
    const { submit, error } = useObject({
      api: '/api/use-object-async-on-finish',
      schema: z.object({ content: z.string() }),
      async onFinish() {
        await Promise.resolve();
        throw finishError;
      },
      onError,
    });

    return (
      <div>
        <div data-testid="async-finish-error">{error?.message}</div>
        <button
          data-testid="async-finish-submit"
          onClick={() => submit('test-input')}
        >
          Submit
        </button>
      </div>
    );
  };

  server.urls['/api/use-object-async-on-finish'].response = {
    type: 'stream-chunks',
    chunks: ['{', '"content":"Hello"', '}'],
  };

  render(<TestComponent />);
  await userEvent.click(screen.getByTestId('async-finish-submit'));

  await waitFor(() => {
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(finishError);
    expect(screen.getByTestId('async-finish-error')).toHaveTextContent(
      'finish failed',
    );
  });
});
