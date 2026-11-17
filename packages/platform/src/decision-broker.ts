export interface DecisionWorker {
  postMessage(value: unknown): void;
  onMessage(callback: (value: unknown) => void): () => void;
  onError(callback: () => void): () => void;
  terminate(): void;
}
export type DecisionResult =
  { status: 'completed'; value: unknown } | { status: 'timeout' | 'unavailable' | 'failed' | 'aborted' };
/** One bounded worker per job. Late callbacks cannot revive an obsolete job. */
export function createDecisionBroker(factory: () => DecisionWorker) {
  let sequence = 0,
    disposed = false;
  let active: { cancel: () => void } | null = null;
  function cancel() {
    active?.cancel();
  }
  async function run(payload: unknown, timeoutMs: number): Promise<DecisionResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000)
      throw new RangeError('Invalid decision timeout');
    cancel();
    if (disposed) return { status: 'aborted' };
    let worker: DecisionWorker;
    try {
      worker = factory();
    } catch {
      return { status: 'unavailable' };
    }
    const id = ++sequence;
    return new Promise((resolve) => {
      let done = false,
        timer: ReturnType<typeof setTimeout> | null = null;
      const unsubscribe: (() => void)[] = [];
      const job = { cancel: () => finish({ status: 'aborted' }) };
      const finish = (result: DecisionResult) => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        for (const stop of unsubscribe) {
          try {
            stop();
          } catch {
            /* Continue releasing the job. */
          }
        }
        try {
          worker.terminate();
        } catch {
          /* The job still completes if platform cleanup reports failure. */
        }
        if (active === job) active = null;
        resolve(result);
      };
      active = job;
      try {
        unsubscribe.push(
          worker.onMessage((value) => {
            if (
              done ||
              active !== job ||
              typeof value !== 'object' ||
              value === null ||
              !('id' in value) ||
              value.id !== id
            )
              return;
            if (!('payload' in value)) return finish({ status: 'failed' });
            finish({ status: 'completed', value: value.payload });
          }),
        );
        unsubscribe.push(worker.onError(() => finish({ status: 'failed' })));
        timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
        worker.postMessage({ id, payload });
      } catch {
        finish({ status: 'failed' });
      }
    });
  }
  return {
    run,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
    },
    get pending() {
      return active !== null;
    },
  };
}
export type DecisionBroker = ReturnType<typeof createDecisionBroker>;
