/** Fixed server-operation classification and Native rate-bucket participation.
 * Reuses client_api_rate_buckets, not a goal/Task/financial ledger or authority.
 * Original owners supply current identity/policy/facts and own commit/unknown;
 * no caller human flags, retries, cleanup, schema creation or default limits. */
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';
export type OriginalMcpTrafficClass = 'protocol_discovery' | 'human_current_review' | 'original_receipt_reconciliation' | 'automatic_business';
const operations = Object.freeze({
  'mcp.initialize': 'protocol_discovery', 'mcp.server.discover': 'protocol_discovery', 'mcp.tools.list': 'protocol_discovery',
  'mcp.resources.list': 'protocol_discovery', 'mcp.resources.templates.list': 'protocol_discovery',
  'mcp.prompts.list': 'protocol_discovery', 'mcp.prompts.get': 'protocol_discovery',
  'original.web.catalog.review': 'human_current_review',
  'original.web.receipt.read': 'original_receipt_reconciliation',
  'mcp.tools.call': 'automatic_business', 'mcp.resources.read': 'automatic_business',
} as const satisfies Record<string, OriginalMcpTrafficClass>);
export type OriginalMcpTrafficOperation = keyof typeof operations;
export interface OriginalMcpTrafficOwner { userId: string; tenantId: string; workspaceId: string }
export interface OriginalMcpTrafficEvidence extends OriginalMcpTrafficOwner {
  kind: 'current_display_review' | 'original_receipt_read'; reference: string; revision: number;
  /** Unix seconds, matching original MCP policy/verification records. */
  expiresAt: number;
}
export interface OriginalMcpTrafficPolicy {
  policyRef: string; policyRevision: number;
  /** Unix seconds; rate-window arithmetic alone uses milliseconds. */
  expiresAt: number; windowSeconds: number; limit: number;
  evidence?: OriginalMcpTrafficEvidence;
}
export interface OriginalMcpTrafficPolicySource<Native extends OAuthSqlTransaction> {
  /** Current ORIGINAL policy and, for independent review/receipt classes, original
   * reference evidence. Native is already owned/authorized; do not re-lock grant
   * or read a global client. Limits/ref changes do not alter bucket ownership. */
  current(operation: OriginalMcpTrafficOperation, owner: Readonly<OriginalMcpTrafficOwner>,
    native: Native, signal: AbortSignal): Promise<OriginalMcpTrafficPolicy | undefined>;
}
const bounds = { stringCharacters: 200, arrayItems: 1 };
const fail = () => new Error('Original MCP traffic metering unavailable');
const key = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const integer = (v: unknown, min: number, max = 2147483647): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail(); };
function exact(raw: unknown, names: readonly string[]): Record<string, unknown> {
  const value = snapshotJson(raw, bounds);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== names.length) throw fail();
  return snapshotJsonFields(value, names, bounds);
}
/** Classify a SERVER-selected registered operation. Never pass a wire method,
 * tool argument, header, URI or clientInfo label directly into this function. */
export function originalMcpTrafficClass(operation: OriginalMcpTrafficOperation): OriginalMcpTrafficClass {
  if (!Object.hasOwn(operations, operation)) throw fail();
  return operations[operation];
}
function capturePolicy(raw: unknown, classification: OriginalMcpTrafficClass, who: OriginalMcpTrafficOwner): OriginalMcpTrafficPolicy {
  const snapshot = snapshotJson(raw, bounds), hasEvidence = !!snapshot && typeof snapshot === 'object' && Object.hasOwn(snapshot, 'evidence');
  const row = exact(snapshot, hasEvidence ? ['policyRef','policyRevision','expiresAt','windowSeconds','limit','evidence'] : ['policyRef','policyRevision','expiresAt','windowSeconds','limit']);
  // Original infrastructure removes buckets older than two hours. A <=1h window
  // cannot lose its current counter to that cleanup; no new cleanup is scheduled.
  if (!key(row.policyRef) || !integer(row.policyRevision, 1) || !integer(row.expiresAt, 1, Number.MAX_SAFE_INTEGER) || row.expiresAt <= Date.now() / 1000
    || !integer(row.windowSeconds, 1, 3600) || !integer(row.limit, 1, 1000000)) throw fail();
  let evidence: OriginalMcpTrafficEvidence | undefined;
  if (classification === 'human_current_review' || classification === 'original_receipt_reconciliation') {
    const e = exact(row.evidence, ['kind','reference','revision','expiresAt','userId','tenantId','workspaceId']);
    const expected = classification === 'human_current_review' ? 'current_display_review' : 'original_receipt_read';
    if (e.kind !== expected || !key(e.reference) || !integer(e.revision, 1) || !integer(e.expiresAt, 1, Number.MAX_SAFE_INTEGER) || e.expiresAt <= Date.now() / 1000
      || e.userId !== who.userId || e.tenantId !== who.tenantId || e.workspaceId !== who.workspaceId) throw fail();
    evidence = Object.freeze({ kind: expected, reference: e.reference, revision: e.revision, expiresAt: e.expiresAt, ...who });
  } else if (hasEvidence) throw fail(); // A human claim cannot reclassify a tool/resource call.
  return Object.freeze({ policyRef: row.policyRef, policyRevision: row.policyRevision, expiresAt: row.expiresAt,
    windowSeconds: row.windowSeconds, limit: row.limit, ...(evidence ? { evidence } : {}) });
}
/** Join the original owner's active Native transaction using the existing atomic
 * rate bucket. No begin/commit/replay; return is NOT a commit or read permission.
 * @param source - original approved policy/fact producer, never a caller assertion.
 * @returns one consumeIn participant for fixed operations and original identities. */
export function createOriginalMcpTrafficMeter<Native extends OAuthSqlTransaction>(source: OriginalMcpTrafficPolicySource<Native>) {
  if (typeof source?.current !== 'function') throw fail();
  const current = source.current.bind(source);
  return Object.freeze({ async consumeIn(operation: OriginalMcpTrafficOperation, rawOwner: OriginalMcpTrafficOwner, native: Native, signal: AbortSignal): Promise<void> {
    live(signal); const classification = originalMcpTrafficClass(operation);
    const o = exact(rawOwner, ['userId','tenantId','workspaceId']);
    if (!key(o.userId) || !key(o.tenantId) || !key(o.workspaceId) || typeof native?.$queryRaw !== 'function' || typeof native.$executeRaw !== 'function') throw fail();
    const owner = Object.freeze({ userId: o.userId, tenantId: o.tenantId, workspaceId: o.workspaceId });
    const policy = capturePolicy(await current(operation, owner, native, signal), classification, owner); live(signal);
    const windowMs = policy.windowSeconds * 1000, now = Date.now(), bucketStart = new Date(Math.floor(now / windowMs) * windowMs);
    // No token, client, query, goal, source ref or policy revision suffix can reset
    // this class/owner counter. This rate is separate from original goal resources.
    const scopeKey = createHash('sha256').update(JSON.stringify({ kind:'original_mcp_traffic_1', classification, owner })).digest('hex');
    const changed = await native.$executeRaw`INSERT INTO client_api_rate_buckets (id, scopeKey, bucketStart, count, createdAt, updatedAt) VALUES (${randomUUID()}, ${scopeKey}, ${bucketStart}, 1, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE count = count + 1, updatedAt = NOW(3)`;
    live(signal); if (changed !== 1 && changed !== 2) throw fail();
    const rows = await native.$queryRaw<unknown[]>`SELECT count FROM client_api_rate_buckets WHERE scopeKey = ${scopeKey} AND bucketStart = ${bucketStart} LIMIT 1 FOR UPDATE`;
    live(signal); const fixedRows = snapshotJson(rows, bounds);
    if (!Array.isArray(fixedRows) || fixedRows.length !== 1) throw fail();
    const count = exact(fixedRows[0], ['count']).count;
    if (!integer(count, 1) || count > policy.limit || Date.now() >= bucketStart.getTime() + windowMs) throw fail();
    if (!isDeepStrictEqual(capturePolicy(await current(operation, owner, native, signal), classification, owner), policy)) throw fail();
    live(signal);
  } });
}
