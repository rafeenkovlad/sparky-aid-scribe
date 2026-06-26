// Per-thread sequential AI request queue.
//
// Пользователь может отправлять (и формировать) запросы параллельно —
// они складываются в очередь по треду; задачи выполняются строго
// последовательно одна за другой. Между разными тредами очереди
// независимы и работают параллельно.

type Task = () => Promise<void>;

const tails = new Map<string, Promise<unknown>>();
const sizes = new Map<string, number>();
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) cb();
}

export function enqueueAI(threadId: string, task: Task): Promise<void> {
  sizes.set(threadId, (sizes.get(threadId) ?? 0) + 1);
  notify();

  const prev = tails.get(threadId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      await task();
    } catch (err) {
      // task должен сам обрабатывать ошибки и писать в чат; здесь только лог.
      // eslint-disable-next-line no-console
      console.error("[aiQueue] task failed:", err);
    } finally {
      const cur = sizes.get(threadId) ?? 1;
      const left = Math.max(0, cur - 1);
      if (left === 0) sizes.delete(threadId);
      else sizes.set(threadId, left);
      notify();
    }
  });

  tails.set(threadId, next);
  // Освобождаем ссылку на завершившуюся цепочку — чтобы не держать память.
  next.finally(() => {
    if (tails.get(threadId) === next) tails.delete(threadId);
  });

  return next;
}

export function getQueueSize(threadId: string): number {
  return sizes.get(threadId) ?? 0;
}

export function subscribeQueue(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
