import type { IncomingMessage } from 'node:http';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';

export type InspectionHttpRequest = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
export async function withInspectionRequestSignal<T>(request: InspectionHttpRequest, work: (signal: AbortSignal) => Promise<T>) {
  const aborter = new AbortController(), abort = () => aborter.abort();
  const listens = typeof request?.once === 'function' && typeof request?.removeListener === 'function';
  if (request?.aborted) abort();
  else if (listens) request.once!('aborted', abort);
  try {
    if (aborter.signal.aborted) throw Object.assign(new Error('interrupted'), { code: 'RECONCILIATION_REQUIRED' });
    return await work(aborter.signal);
  } finally { if (listens) request.removeListener!('aborted', abort); }
}

export async function respondInspectionHttp<T>(work: () => Promise<T>, nextAction: string) {
  try { return await work(); }
  catch (error) {
    const aliases: Record<string, string> = { INVALID_INPUT: 'AI_INVALID_INPUT', ACCESS_DENIED: 'AI_ACCESS_DENIED',
      BINDING_CHANGED: 'AI_PROPOSAL_STALE', TEMPLATE_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE',
      CAPABILITY_UNSUPPORTED: 'AI_RESOURCE_UNAVAILABLE', STORAGE_UNAVAILABLE: 'AI_STORAGE_UNAVAILABLE',
      REVISION_CONFLICT: 'AI_REVISION_CONFLICT', RECONCILIATION_REQUIRED: 'AI_RESULT_UNKNOWN' };
    const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403,
      AI_SCOPE_CHANGED: 403, AI_PROPOSAL_STALE: 409, AI_RESOURCE_UNAVAILABLE: 503,
      AI_STORAGE_UNAVAILABLE: 503, AI_REVISION_CONFLICT: 409, AI_RESULT_UNKNOWN: 409 };
    const original = error instanceof Error && 'code' in error ? error.code : undefined;
    let code = error instanceof z.ZodError ? 'AI_INVALID_INPUT'
      : typeof original === 'string' ? aliases[original] ?? original : 'AI_STORAGE_UNAVAILABLE';
    if (error instanceof HttpException && error.getStatus() === 400) code = 'AI_INVALID_INPUT';
    if (!Object.prototype.hasOwnProperty.call(statuses, code)) code = 'AI_STORAGE_UNAVAILABLE';
    throw new HttpException({ code, retryable: false,
      ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction } : {}) }, statuses[code]);
  }
}
