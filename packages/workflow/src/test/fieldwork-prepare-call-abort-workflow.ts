import { getWritable } from 'workflow';
import { WorkflowAgent } from '../workflow-agent.js';
import { mockTextModel } from '../providers/mock.js';

/**
 * Fieldwork characterization for a live AbortSignal returned from prepareCall.
 *
 * The signal intentionally remains live. This distinguishes the ordinary
 * Workflow step-serialization path from the already-aborted pre-step path
 * covered by the unit regression for #18713.
 */
export async function agentPrepareCallLiveAbortSignalE2e() {
  'use workflow';

  const controller = new AbortController();
  const agent = new WorkflowAgent({
    model: mockTextModel('ok'),
    prepareCall: () => ({ abortSignal: controller.signal }),
  });

  const result = await agent.stream({
    messages: [{ role: 'user', content: 'test' }],
    writable: getWritable(),
  });

  return {
    stepCount: result.steps.length,
    lastStepText: result.steps[result.steps.length - 1]?.text,
  };
}
