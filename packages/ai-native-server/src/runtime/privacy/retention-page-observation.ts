import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AI_RETENTION_POLICY } from './retention-policy';

type Page = { scopeKind: 'workspace' | 'platform'; scopeId: string; kind: string; after?: string };
const tag = (value: string) => createHash('sha256').update(value).digest('hex');
const logger = new Logger('AiRetention');

export function logInterruptedRetention(scopeKind: Page['scopeKind'], status: number) {
  try { logger.warn({ event: 'ai.retention.page_interrupted', scopeKind, status, nextAction: 'list_retention_receipts' }); }
  catch { /* An unavailable log sink cannot change the original HTTP outcome. */ }
}

export function retentionCandidate(id: string, basis?: Date | null, days: 7 | 30 = 30, expiry?: Date) {
  const dueAt = basis instanceof Date ? Math.max(basis.getTime() + days * 86400000, expiry?.getTime() ?? 0) : NaN;
  return { id, dueAt: Number.isFinite(dueAt) ? dueAt : null };
}

export function retentionPageObservation(page: Page, at: Date, candidates: ReturnType<typeof retentionCandidate>[],
  results: ReadonlyArray<{ state: string }>, nextAfter: string | null) {
  let erased = 0, withdrawn = 0, held = 0, pending = 0, overdue = 0, missingDeadline = 0;
  let oldestOverdueMs: number | null = null;
  for (const [index, candidate] of candidates.entries()) {
    const state = results[index]?.state;
    if (state === 'erased') { erased++; continue; }
    if (state === 'withdrawn') { withdrawn++; continue; }
    if (state === 'held') held++;
    else pending++;
    if (candidate.dueAt === null) missingDeadline++;
    else if (candidate.dueAt <= at.getTime()) {
      overdue++;
      oldestOverdueMs = Math.max(oldestOverdueMs ?? 0, at.getTime() - candidate.dueAt);
    }
  }
  return { event: 'ai.retention.page', policy: AI_RETENTION_POLICY.version, scopeKind: page.scopeKind, scope: tag(page.scopeId), kind: page.kind,
    observedAt: at.toISOString(), coverage: 'bounded_candidate_page', scanned: candidates.length, erased, withdrawn, held, pending, overdue, oldestOverdueMs,
    missingDeadline, afterHash: page.after ? tag(page.after) : null, nextHash: nextAfter ? tag(nextAfter) : null };
}

export function logRetentionPage(page: Page, at: Date, candidates: ReturnType<typeof retentionCandidate>[], results: ReadonlyArray<{ state: string }>, nextAfter: string | null) {
  try {
    const observation = retentionPageObservation(page, at, candidates, results, nextAfter);
    if (observation.pending) logger.warn(observation);
    else logger.log(observation);
  } catch { /* The original cleanup receipt remains authoritative when logging is unavailable. */ }
}
