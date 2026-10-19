/**
 * A strictly serial, priority-ordered task queue (T99). The dashboard's
 * reads all share ONE background connection, so running them concurrently
 * buys nothing — but the ORDER they run in decides what Mitch sees first.
 * Lower priority number runs first; equal priorities run FIFO. A task that
 * throws rejects only its own promise; the queue keeps draining.
 *
 * Pure (no expo imports) so the ordering contract is unit-tested in Node.
 */
export interface ReadQueue {
  run<T>(priority: number, task: () => Promise<T>): Promise<T>;
}

interface Pending {
  priority: number;
  seq: number;
  start: () => void;
}

export function createReadQueue(): ReadQueue {
  const pending: Pending[] = [];
  let running = false;
  let seq = 0;

  const drain = () => {
    if (running) return;
    pending.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const next = pending.shift();
    if (!next) return;
    running = true;
    next.start();
  };

  return {
    run<T>(priority: number, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push({
          priority,
          seq: seq++,
          start: () => {
            task()
              .then(resolve, reject)
              .finally(() => {
                running = false;
                drain();
              });
          },
        });
        // Defer so every query a render enqueues is in the list before the
        // first one is picked — otherwise mount order, not priority, wins.
        queueMicrotask(drain);
      });
    },
  };
}
