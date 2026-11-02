import React, { Component, Suspense, useState, type ComponentType, type ReactNode } from 'react';

export interface LazyChunkProps<P extends object> {
  /** Imports the chunk with the component. */
  load: () => Promise<{ default: ComponentType<P> }>;
  props: P;
  /** Shows while the chunk loads. */
  fallback: ReactNode;
  /** Shows when the chunk did not load. retry loads it again. */
  failed: (retry: () => void) => ReactNode;
}

class LoadBoundary extends Component<
  { children: ReactNode; failed: (retry: () => void) => ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return this.props.failed(() => {
      this.setState({ failed: false });
      this.props.onRetry();
    });
  }
}

/**
 * A component of a lazy chunk (the bindings popup, the option editors, the YAML editor). View mode never loads these
 * chunks. React keeps a rejected load, so a retry makes a new lazy component.
 */
export function LazyChunk<P extends object>({ load, props, fallback, failed }: LazyChunkProps<P>) {
  // The lazy type has no ref in P: the plain component type lets the props through.
  const lazy = () => React.lazy(load) as unknown as ComponentType<P>;
  const [Loaded, setLoaded] = useState(lazy);
  return (
    <LoadBoundary failed={failed} onRetry={() => setLoaded(lazy)}>
      <Suspense fallback={fallback}>
        <Loaded {...props} />
      </Suspense>
    </LoadBoundary>
  );
}
