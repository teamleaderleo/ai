import { describe, expect, it } from 'vitest';
import { start } from 'workflow/api';
import { agentPrepareCallLiveAbortSignalE2e } from './test/fieldwork-prepare-call-abort-workflow.js';

describe('Fieldwork: WorkflowAgent prepareCall AbortSignal', () => {
  it('carries a live prepareCall AbortSignal into the workflow model step', async () => {
    const run = await start(agentPrepareCallLiveAbortSignalE2e, []);

    await expect(run.returnValue).resolves.toMatchObject({
      stepCount: 1,
      lastStepText: 'ok',
    });
  });
});
