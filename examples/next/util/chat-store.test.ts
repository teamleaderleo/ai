import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateId: () => 'generated-chat-id',
}));

import {
  prepareChatForNewRun,
  readChat,
  saveChat,
} from './chat-store';

describe.sequential('resumable chat new-run state transition', () => {
  let originalCwd: string;
  let testDirectory: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDirectory = await mkdtemp(
      path.join(tmpdir(), 'ai-sdk-resumable-stop-'),
    );
    process.chdir(testDirectory);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDirectory, { recursive: true, force: true });
  });

  it('clears the previous Stop timestamp before the next run reads chat state', async () => {
    const id = 'chat-1';

    await saveChat({
      id,
      messages: [],
      activeStreamId: 'stream-a',
      canceledAt: 123,
    });

    const previousRun = await readChat(id);
    expect(previousRun).toMatchObject({
      activeStreamId: 'stream-a',
      canceledAt: 123,
    });

    await prepareChatForNewRun({ id, messages: [] });

    // The first cancellation poll made after the awaited transition sees the
    // new run's state, not the durable Stop marker from the previous run.
    const nextRun = await readChat(id);
    expect(nextRun).toMatchObject({
      id,
      messages: [],
      activeStreamId: null,
      canceledAt: null,
    });
    expect(nextRun.createdAt).toBe(previousRun.createdAt);
  });
});
