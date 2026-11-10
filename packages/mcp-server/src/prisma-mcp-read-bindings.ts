/** Immutable ORIGINAL goal/read associations, not goal creation or authorization.
 * Only a trusted original goal writer publishes in its native transaction. Reads
 * require callback-local original subject and current goal evidence; no latest
 * selection, credential/input storage, retargeting, cleanup or counter reset. */
import { isDeepStrictEqual } from 'node:util';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import { captureMcpReadInput } from './persistent-read-accounting.js';
import type { OriginalMcpReadCallRef } from './persistent-read-accounting.js';
import { captureOriginalMcpReadTarget } from './prisma-mcp-read-budget.js';
import type { OriginalMcpReadTarget } from './prisma-mcp-read-budget.js';
import type { OriginalMcpReadInputTargetSource } from './prisma-mcp-read-accounting.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';

export interface OriginalMcpReadGoalOwner {
  userId: string; tenantId: string; workspaceId?: string; grantId: string; grantRevision: number;
}
export interface OriginalMcpReadInvocationBinding { toolName: string; inputHash: string }
export interface OriginalMcpReadGoalPublication {
  target: OriginalMcpReadTarget; owner: OriginalMcpReadGoalOwner; bindings: readonly OriginalMcpReadInvocationBinding[];
}
export interface OriginalMcpReadBindingAuthority<Native extends OAuthSqlTransaction, Owner extends OriginalMcpReadGoalOwner> {
  /** ORIGINAL existing-goal/current-writer evidence in this same transaction.
   * No model goal ID, claimed human flag, new goal or seed. Missing must fail. */
  readExisting(goalId: string, native: Native, signal: AbortSignal): Promise<OriginalMcpReadGoalPublication | undefined>;
  /** ORIGINAL request-to-existing-goal locator under its native fences, never a
   * caller goal ID, token/connection-derived goal or latest-row selection. Missing
   * is confirmed no association; unreadable/ambiguous evidence must throw. */
  locate(call: OriginalMcpReadCallRef, owner: Owner, native: Native, signal: AbortSignal): Promise<string | undefined>;
  /** Original CURRENT goal/input/policy fences. The enclosing business authority
   * owns grant/identity locks: never reacquire those here or trust stored policy
   * as permanent authority. False is confirmed no current goal; failures throw. */
  current(target: OriginalMcpReadTarget, binding: OriginalMcpReadInvocationBinding, owner: Owner, native: Native, signal: AbortSignal): Promise<boolean>;
  /** Original publication audit in the same native transaction, not a new ledger. */
  auditPublished(goalId: string, bindingKeys: readonly string[], native: Native, signal: AbortSignal): Promise<void>;
}
const fail = () => new Error('Original MCP goal/read association unavailable');
const live = (s: AbortSignal) => { if (s.aborted) throw fail(); };
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const limits = { stringCharacters: 32768, arrayItems: 32 };
function object(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  const value = snapshotJson(raw, limits);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length) throw fail();
  return snapshotJsonFields(value, fields, limits);
}
function owner(raw: unknown): Required<OriginalMcpReadGoalOwner> {
  const r = snapshotJsonFields(raw, ['userId', 'tenantId', 'workspaceId', 'grantId', 'grantRevision'], limits);
  if (!id(r.userId) || !id(r.tenantId) || !id(r.workspaceId) || !id(r.grantId)
    || typeof r.grantRevision !== 'number' || !Number.isSafeInteger(r.grantRevision) || r.grantRevision < 1 || r.grantRevision > 2147483647) throw fail();
  return Object.freeze({ userId: r.userId, tenantId: r.tenantId, workspaceId: r.workspaceId, grantId: r.grantId, grantRevision: r.grantRevision });
}
function invocation(raw: unknown): OriginalMcpReadInvocationBinding {
  const r = object(raw, ['toolName', 'inputHash']);
  if (typeof r.toolName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.toolName) || !digest(r.inputHash)) throw fail();
  return Object.freeze({ toolName: r.toolName, inputHash: r.inputHash });
}
// The ORIGINAL locator distinguishes legitimate goals with identical queries.
// Caller IDs cannot choose it; the budget still has one immutable goal counter.
const keyFor = (goalId: string, grantId: string, b: OriginalMcpReadInvocationBinding) => captureMcpReadInput({ goalId, grantId, ...b }).inputHash;
function publication(raw: unknown, goalId: string): OriginalMcpReadGoalPublication {
  const r = object(raw, ['target', 'owner', 'bindings']), target = captureOriginalMcpReadTarget(r.target), subject = owner(r.owner);
  // snapshotJson bounds this metadata batch to 32; it is not the 20-call quota.
  if (target.goalId !== goalId || target.grantId !== subject.grantId || !Array.isArray(r.bindings) || !r.bindings.length) throw fail();
  const bindings = r.bindings.map(invocation).sort((a, b) => {
    const left = keyFor(target.goalId, subject.grantId, a), right = keyFor(target.goalId, subject.grantId, b); return left < right ? -1 : left > right ? 1 : 0;
  });
  if (new Set(bindings.map(b => keyFor(target.goalId, subject.grantId, b))).size !== bindings.length) throw fail();
  return Object.freeze({ target, owner: subject, bindings: Object.freeze(bindings) });
}
type Association = { target: OriginalMcpReadTarget; owner: OriginalMcpReadGoalOwner; binding: OriginalMcpReadInvocationBinding };
function stored(raw: unknown, key: string): Association {
  const r = object(raw, ['bindingKey', 'goalId', 'grantId', 'grantRevision', 'userId', 'tenantId', 'workspaceId', 'toolName', 'inputHash', 'recordHash', 'recordJson']);
  const json = typeof r.recordJson === 'string' ? JSON.parse(r.recordJson) : r.recordJson;
  const value = object(json, ['target', 'owner', 'binding']), target = captureOriginalMcpReadTarget(value.target), subject = owner(value.owner), binding = invocation(value.binding);
  const captured = captureMcpReadInput({ target, owner: subject, binding });
  if (r.bindingKey !== key || keyFor(target.goalId, subject.grantId, binding) !== key || r.goalId !== target.goalId || r.grantId !== target.grantId
    || subject.grantId !== target.grantId || r.grantRevision !== subject.grantRevision || r.userId !== subject.userId || r.tenantId !== subject.tenantId
    || r.workspaceId !== subject.workspaceId || r.toolName !== binding.toolName || r.inputHash !== binding.inputHash || r.recordHash !== captured.inputHash) throw fail();
  return Object.freeze({ target, owner: subject, binding });
}

/** Publish/read original associations; requires provisioned InnoDB structure.
 * @param authority - actual existing-goal/current-policy/audit owner, no defaults.
 * @param subjects - original callback-local current grant/Guard subject reader.
 * @returns native publishIn and input-aware target source. Publish is NOT commit;
 * its original caller owns atomic goal/publication/audit rollback and unknown. */
export function createPrismaMcpReadBindings<Native extends OAuthSqlTransaction, Owner extends OriginalMcpReadGoalOwner>(
  authority: OriginalMcpReadBindingAuthority<Native, Owner>, subjects: { current(call: OriginalMcpReadCallRef): Owner }
): { publishIn(goalId: string, native: Native, signal: AbortSignal): Promise<void>; source: OriginalMcpReadInputTargetSource<Native> } {
  if (typeof authority?.readExisting !== 'function' || typeof authority.locate !== 'function' || typeof authority.current !== 'function' || typeof authority.auditPublished !== 'function'
    || typeof subjects?.current !== 'function') throw fail();
  const original = authority.readExisting.bind(authority), locate = authority.locate.bind(authority), current = authority.current.bind(authority), audit = authority.auditPublished.bind(authority), subjectFor = subjects.current.bind(subjects);
  const read = async (native: Native, key: string, s: AbortSignal): Promise<Association | undefined> => {
    live(s);
    // Original writer may already own its goal fence. Never wait for a binding
    // held by a reader waiting for that goal; NOWAIT fails/rolls back, no retry.
    const rows = await native.$queryRaw<unknown[]>`SELECT bindingKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, toolName, inputHash, recordHash, recordJson FROM mcp_read_target_bindings WHERE bindingKey = ${key} FOR UPDATE NOWAIT`;
    live(s); if (!Array.isArray(rows) || rows.length > 1) throw fail();
    return rows.length ? stored(rows[0], key) : undefined;
  };
  return Object.freeze({
    async publishIn(goalId: string, native: Native, s: AbortSignal): Promise<void> {
      live(s); if (!id(goalId)) throw fail();
      const before = publication(await original(goalId, native, s), goalId); live(s);
      const added: string[] = [];
      for (const binding of before.bindings) {
        const key = keyFor(goalId, before.owner.grantId, binding), expected = { target: before.target, owner: before.owner, binding };
        const existing = await read(native, key, s);
        if (existing) { if (!isDeepStrictEqual(existing, expected)) throw fail(); continue; }
        const captured = captureMcpReadInput(expected), text = JSON.stringify(captured.input), o = owner(before.owner);
        const count = await native.$executeRaw`INSERT INTO mcp_read_target_bindings (bindingKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, toolName, inputHash, recordHash, recordJson) VALUES (${key}, ${goalId}, ${o.grantId}, ${o.grantRevision}, ${o.userId}, ${o.tenantId}, ${o.workspaceId}, ${binding.toolName}, ${binding.inputHash}, ${captured.inputHash}, ${text})`;
        live(s); if (count !== 1) throw fail(); added.push(key);
      }
      if (added.length) { await audit(goalId, Object.freeze(added), native, s); live(s); }
      if (!isDeepStrictEqual(before, publication(await original(goalId, native, s), goalId))) throw fail(); live(s);
    },
    source: Object.freeze({ async resolve(call: OriginalMcpReadCallRef, input: unknown, native: Native, s: AbortSignal): Promise<OriginalMcpReadTarget | undefined> {
      live(s); if (captureMcpReadInput(input).inputHash !== call.inputHash) throw fail();
      const currentSubject = subjectFor(call), before = owner(currentSubject), binding = invocation({ toolName: call.toolName, inputHash: call.inputHash });
      const goalId = await locate(call, currentSubject, native, s); live(s);
      if (goalId === undefined) return undefined; if (!id(goalId)) throw fail();
      const value = await read(native, keyFor(goalId, before.grantId, binding), s);
      if (!value) return undefined;
      if (!isDeepStrictEqual(value.owner, before)) return undefined;
      const target = captureOriginalMcpReadTarget(value.target, { authorization: call.authorization });
      const valid = await current(target, binding, currentSubject, native, s); live(s);
      if (valid === false) return undefined; if (valid !== true || !isDeepStrictEqual(before, owner(subjectFor(call)))) throw fail();
      if (await locate(call, currentSubject, native, s) !== goalId) throw fail(); live(s);
      if (!isDeepStrictEqual(before, owner(subjectFor(call)))) throw fail();
      return target;
    } }),
  });
}
