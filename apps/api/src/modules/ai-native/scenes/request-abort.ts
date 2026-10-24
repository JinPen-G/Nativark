import type { IncomingMessage, ServerResponse } from 'node:http';

export type AiResponseAbortSource = Partial<Pick<ServerResponse, 'once' | 'removeListener' | 'writableFinished' | 'destroyed'>>;
export type AiRequestAbortSource = Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>> & {
  /** Express-owned response, never a body field. */
  res?: AiResponseAbortSource;
};
export class AiRequestWaitError extends Error {
  readonly retryable = false;
  constructor(readonly code: 'AI_RESOURCE_UNAVAILABLE' | 'AI_RESULT_UNKNOWN') { super(code); }
}
/** Server-owned HTTP wait bound, not a task/lease TTL or new resource allowance. */
export type AiRequestWaitOptions = {
  maxWaitMs?: number;
  clock?: { setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void };
};
/** Body completion is not cancellation; abort never proves remote rollback.
 * A dependency ignoring AbortSignal must not hold the HTTP host indefinitely.
 * Its late completion is observed but cannot replace an unknown response or
 * grant another execution. Original evidence must be read after interruption.
 */
export async function withRequestAbort<T>(request: AiRequestAbortSource, work: (signal: AbortSignal) => Promise<T>, options: AiRequestWaitOptions = {}) {
  const maxWaitMs = options.maxWaitMs ?? 120000;
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1 || maxWaitMs > 120000 || typeof work !== 'function') {
    throw new AiRequestWaitError('AI_RESOURCE_UNAVAILABLE');
  }
  const clock = options.clock ?? { setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const controller = new AbortController();
  const listens = typeof request?.once === 'function' && typeof request?.removeListener === 'function';
  const response = request?.res;
  const listensResponse = typeof response?.once === 'function' && typeof response?.removeListener === 'function';
  // A request that already arrived aborted still delivers its explicit
  // submission to the application: the application's own abort checks own the
  // not-started outcomes. Only abandonment during flight rejects the wait.
  const preAborted = Boolean(request?.aborted)
    || Boolean(response?.destroyed) && response?.writableFinished !== true;
  return new Promise<T>((resolve, reject) => {
    let settled = false, timer: unknown, timerStarted = false;
    const cleanup = () => {
      // Cleanup failures cannot revive the response or wait for a dependency.
      try { if (timerStarted) clock.clearTimeout(timer); } catch { /* bounded host is already closing */ }
      try { if (listens) request.removeListener!('aborted', abort); } catch { /* do not override the original outcome */ }
      try { if (listensResponse) response.removeListener!('close', responseClosed); } catch { /* same */ }
    };
    const finish = (ok: boolean, value: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      if (ok) resolve(value as T); else reject(value);
    };
    const abort = () => {
      if (settled) return;
      finish(false, new AiRequestWaitError('AI_RESULT_UNKNOWN'));
      controller.abort();
    };
    const responseClosed = () => { if (response?.writableFinished !== true) abort(); };
    try {
      if (listens) request.once!('aborted', abort);
      if (listensResponse) response.once!('close', responseClosed);
      timer = clock.setTimeout(abort, maxWaitMs); timerStarted = true;
      if (settled) { cleanup(); return; }
      if (preAborted) controller.abort();
      // Attach both handlers even if the dependency later ignores interruption.
      Promise.resolve(work(controller.signal)).then(value => finish(true, value), error => finish(false, error));
    } catch (error) { finish(false, error); }
  });
}
