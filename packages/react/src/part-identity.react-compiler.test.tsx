import { act, cleanup, render, screen } from '@testing-library/react';
import React, { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

type Part = {
  type: 'text';
  text: string;
};

function CompiledPart({ part }: { part: Part }) {
  'use memo';
  return <span data-testid="compiled-part">{part.text}</span>;
}

class AliasedPartStore {
  private listeners = new Set<() => void>();
  private part: Part = { type: 'text', text: 'a' };
  private snapshot = [{ id: 'm1', part: this.part }];

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  mutateNestedPartAndRepublishParent() {
    this.part.text = 'ab';
    this.snapshot = [{ id: 'm1', part: this.part }];
    this.listeners.forEach(listener => listener());
  }
}

function App({ store }: { store: AliasedPartStore }) {
  const messages = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return <CompiledPart part={messages[0].part} />;
}

afterEach(cleanup);

describe('React Compiler part identity negative control', () => {
  it('keeps compiled child output stale when a mutated part keeps its identity', async () => {
    const store = new AliasedPartStore();
    render(<App store={store} />);

    expect(screen.getByTestId('compiled-part')).toHaveTextContent('a');

    await act(async () => {
      store.mutateNestedPartAndRepublishParent();
      await Promise.resolve();
    });

    // This must remain stale under the compiler. If it renders "ab", the
    // compiler discriminator is not exercising the historical identity class.
    expect(screen.getByTestId('compiled-part')).toHaveTextContent('a');
  });
});
