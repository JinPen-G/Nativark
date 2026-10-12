import type { IncomingMessage } from 'node:http';

export type AiRequestAbortSource = Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
/** Body completion is not cancellation; abort never proves remote rollback. */
export async function withRequestAbort<T>(request: AiRequestAbortSource, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController(), abort = () => controller.abort();
  const listens = typeof request?.once === 'function' && typeof request?.removeListener === 'function';
  if (request?.aborted) abort();
  else if (listens) request.once!('aborted', abort);
  try { return await work(controller.signal); }
  finally { if (listens) request.removeListener!('aborted', abort); }
}
