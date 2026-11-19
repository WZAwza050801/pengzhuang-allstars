import type { HostedView, Viewport } from './types';

/** Owns asynchronous mounting; a cancelled/obsolete mount can never retain its late view. */
export function createHostBridge<Root, Context>(
  factory: (root: Root, context: Context, signal: AbortSignal) => HostedView | Promise<HostedView>,
) {
  let generation = 0;
  let disposed = false;
  let suspended = false;
  let view: HostedView | null = null;
  let controller: AbortController | null = null;
  let viewport: Viewport | null = null;
  return {
    async mount(root: Root, context: Context) {
      if (disposed) throw new Error('Host bridge disposed');
      const own = ++generation;
      controller?.abort();
      const previous = view;
      view = null;
      previous?.dispose();
      const abort = new AbortController();
      controller = abort;
      const created = await factory(root, context, abort.signal);
      if (disposed || own !== generation || abort.signal.aborted) {
        created.dispose();
        return;
      }
      view = created;
      if (viewport) created.resize(viewport);
      if (suspended) created.suspend();
    },
    resize(next: Viewport) {
      viewport = next;
      view?.resize(next);
    },
    suspend() {
      suspended = true;
      view?.suspend();
    },
    async resume() {
      if (!disposed) {
        suspended = false;
        view?.resume();
      }
    },
    async dispose() {
      if (!disposed) {
        disposed = true;
        generation++;
        controller?.abort();
        const previous = view;
        view = null;
        previous?.dispose();
      }
    },
  };
}
