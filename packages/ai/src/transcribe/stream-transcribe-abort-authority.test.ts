import { describe, expect, it } from 'vitest';
import { MockTranscriptionModelV4 } from '../test/mock-transcription-model-v4';
import { streamTranscribe } from './stream-transcribe';

type Outcome<T> =
  | { status: 'resolved'; value: T }
  | { status: 'rejected'; error: unknown }
  | { status: 'timed-out' };

function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<Outcome<T>> {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve({ status: 'resolved', value });
      },
      error => {
        clearTimeout(timeout);
        resolve({ status: 'rejected', error });
      },
    );
  });
}

describe('streamTranscribe caller-abort authority', () => {
  it.fails(
    'caller abort settles transcription result promises when doStream ignores its signal',
    async () => {
      const controller = new AbortController();
      const reason = new DOMException('caller stopped transcription', 'AbortError');
      let observedSignal: AbortSignal | undefined;
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => {
        markStarted = resolve;
      });

      const result = streamTranscribe({
        model: new MockTranscriptionModelV4({
          doStream: ({ abortSignal }) => {
            observedSignal = abortSignal;
            markStarted();
            return new Promise(() => {});
          },
        }),
        audio: new ReadableStream<Uint8Array>(),
        inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
        abortSignal: controller.signal,
      });

      const outcomePromise = settleWithin(result.text);
      await started;
      controller.abort(reason);

      expect(observedSignal?.aborted).toBe(true);
      const outcome = await outcomePromise;
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.error).toBe(reason);
      }
    },
  );
});
