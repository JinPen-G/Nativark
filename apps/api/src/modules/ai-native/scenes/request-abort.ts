import type { IncomingMessage, ServerResponse } from 'node:http';

export type AiResponseAbortSource = Partial<Pick<ServerResponse, 'once' | 'removeListener' | 'writableFinished' | 'destroyed'>>;
export type AiRequestAbortSource = Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>> & {
  /** Express-owned response, never a body field. */
  res?: AiResponseAbortSource;
};
/** Body completion is not cancellation; abort never proves remote rollback. */
export async function withRequestAbort<T>(request: AiRequestAbortSource, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController(), abort = () => controller.abort();
  const listens = typeof request?.once === 'function' && typeof request?.removeListener === 'function';
  const response = request?.res;
  const listensResponse = typeof response?.once === 'function' && typeof response?.removeListener === 'function';
  const responseClosed = () => { if (response?.writableFinished !== true) abort(); };
  if (request?.aborted) abort();
  else if (listens) request.once!('aborted', abort);
  if (response?.destroyed) responseClosed();
  else if (listensResponse) response.once!('close', responseClosed);
  try { return await work(controller.signal); }
  finally {
    if (listens) request.removeListener!('aborted', abort);
    if (listensResponse) response.removeListener!('close', responseClosed);
  }
}
