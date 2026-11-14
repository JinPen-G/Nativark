/** Shared client lifecycle for a public browse reference and explicit login
 * continuation. It stores locators and short public ownership only, never the
 * public body, customer bearer, model input or booking approval. Unknown writes
 * are observed under their original keys; host/session changes withdraw views. */
import { z } from 'zod';
import { aiClientPublicSessionRequestSchema, aiClientPublicSessionResponseSchema,
  aiClientPublicPreparationResponseSchema, aiClientPublicOperationResponseSchema,
  aiClientPublicContinuationResponseSchema, type AiClientPublicSessionRequest,
  type AiClientPublicSessionResponse, type AiClientPublicPreparationRequest,
  type AiClientPublicPreparationResponse, type AiClientPublicOperationRequest, type AiClientPublicOperationResponse,
  type AiClientPublicContinuationRequest, type AiClientPublicContinuationReadRequest,
  type AiClientPublicContinuationResponse } from './ai-client-public-draft';

const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const source = z.object({ publicRef: z.string().uuid(), materialHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const recordSchema = z.object({ version: z.literal('ain-public-continuity-session-1'), target: aiClientPublicSessionRequestSchema,
  channel: z.enum(['web', 'wechat_miniprogram']), kind: z.enum(['catalog', 'help']), operationKey: key,
  ownership: aiClientPublicSessionResponseSchema, original: source.nullable(),
  continuation: z.object({ ownerKey: z.string().min(1).max(1024), operationKey: key,
    receipt: aiClientPublicContinuationResponseSchema.nullable() }).strict().nullable() }).strict();
type Record = z.infer<typeof recordSchema>;
export interface AiClientPublicContinuityApi {
  issueSession(input: AiClientPublicSessionRequest): Promise<AiClientPublicSessionResponse>;
  prepare(input: AiClientPublicPreparationRequest, credential: string): Promise<AiClientPublicPreparationResponse>;
  readOriginal(input: AiClientPublicOperationRequest, credential: string): Promise<AiClientPublicOperationResponse>;
  continueOriginal(input: AiClientPublicContinuationRequest, credential: string): Promise<AiClientPublicContinuationResponse>;
  readContinuation(input: AiClientPublicContinuationReadRequest): Promise<AiClientPublicContinuationResponse>;
}
export interface AiClientPublicContinuityView {
  status: 'idle' | 'observed' | 'unknown' | 'continued' | 'unavailable' | 'identity_changed' | 'closed';
  expiresAt: string | null; canPrepare: boolean; canContinue: boolean; canRead: boolean; loginRequired: boolean;
}
type Dependencies = { target: AiClientPublicSessionRequest; channel: 'web' | 'wechat_miniprogram'; kind: 'catalog' | 'help';
  current(): boolean; client(): { ownerKey: string; current(): boolean } | null;
  api: AiClientPublicContinuityApi; now(): number; newKey(): string;
  storage: { read(): unknown; write(value: unknown): void }; changed(view: AiClientPublicContinuityView): void };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createAiClientPublicContinuitySession(input: Dependencies) {
  const target = aiClientPublicSessionRequestSchema.parse(copy(input.target));
  if (!['web', 'wechat_miniprogram'].includes(input.channel) || !['catalog', 'help'].includes(input.kind)) throw Error('public_context_invalid');
  let record: Record | null = null, active = true, busy = false, usable = true;
  let status: AiClientPublicContinuityView['status'] = 'idle', knownOriginal = false;
  const current = () => active && input.current();
  const check = () => { if (!current()) throw Error('public_context_changed'); };
  const now = () => { const time = input.now(); if (!Number.isFinite(time)) throw Error('public_clock_unavailable'); return time; };
  const snapshot = (): AiClientPublicContinuityView => {
    const client = current() ? input.client() : null, ownershipMatches = !record?.continuation
      || !!client && client.current() && client.ownerKey === record.continuation.ownerKey;
    const expiresAt = record?.original?.expiresAt ?? null;
    const valid = expiresAt !== null && Date.parse(expiresAt) > now();
    return { status: !current() ? 'closed' : !ownershipMatches ? 'identity_changed' : status, expiresAt,
      canPrepare: current() && usable && !busy && (!record || knownOriginal && !valid && !record.continuation),
      canContinue: current() && usable && !busy && ownershipMatches && knownOriginal && valid && !record?.continuation
        && !!client && client.current(),
      canRead: current() && usable && !busy && !!record && ownershipMatches,
      loginRequired: current() && usable && knownOriginal && valid && !record?.continuation && !client };
  };
  const emit = () => { if (current()) input.changed(snapshot()); };
  const persist = (next: Record) => {
    check(); const parsed = recordSchema.parse(copy(next));
    input.storage.write(parsed);
    if (!same(recordSchema.parse(input.storage.read()), parsed)) throw Error('public_original_reference_not_retained');
    check(); record = parsed;
  };
  const original = (value: AiClientPublicOperationResponse | AiClientPublicPreparationResponse) => {
    if (!record || value.operationKey !== record.operationKey) throw Error('public_original_changed');
    if (value.state === 'unknown') { knownOriginal = false; status = 'unknown'; return; }
    if (value.kind !== input.kind || !value.publicRef || !value.materialHash || !value.expiresAt) throw Error('public_original_changed');
    const reference = source.parse({ publicRef: value.publicRef, materialHash: value.materialHash, expiresAt: value.expiresAt });
    if (record.original && !same(record.original, reference)) throw Error('public_original_changed');
    persist({ ...record, original: reference }); knownOriginal = true; status = 'observed';
  };
  const continuation = (value: AiClientPublicContinuationResponse, ownerKey: string) => {
    if (!record?.original || !record.continuation || record.continuation.ownerKey !== ownerKey
      || value.publicRef !== record.original.publicRef || value.operationKey !== record.continuation.operationKey) throw Error('public_continuation_changed');
    if (value.state === 'unknown') { status = 'unknown'; return; }
    const previous = record.continuation.receipt;
    if (previous && !same(previous, value)) throw Error('public_continuation_changed');
    persist({ ...record, continuation: { ...record.continuation, receipt: value } }); status = 'continued';
  };
  const read = async () => {
    check(); if (!record) { status = 'idle'; return; }
    if (record.original && record.continuation) {
      // Current client receipt recovery is independent of an anonymous token's
      // lifetime/key and public publication. It never needs to mint ownership.
      const client = input.client();
      if (!client || !client.current() || client.ownerKey !== record.continuation.ownerKey) { status = 'identity_changed'; return; }
      const value = aiClientPublicContinuationResponseSchema.parse(await input.api.readContinuation({ ...target,
        publicRef: record.original.publicRef, operationKey: record.continuation.operationKey, expectedMaterialHash: record.original.materialHash }));
      check(); if (!client.current() || input.client()?.ownerKey !== client.ownerKey) throw Error('public_client_changed');
      continuation(value, client.ownerKey); return;
    }
    const proof = record;
    const value = aiClientPublicOperationResponseSchema.parse(await input.api.readOriginal({ ...target, operationKey: proof.operationKey }, proof.ownership.credential));
    check();
    original(value);
  };
  const work = async (action: () => Promise<void>) => {
    check(); if (busy || !usable) return snapshot();
    busy = true; emit();
    try { await action(); }
    catch { if (current()) { knownOriginal = false; status = record ? 'unknown' : 'unavailable'; } }
    finally { busy = false; emit(); }
    return snapshot();
  };
  return Object.freeze({ snapshot,
    async open() {
      check();
      try {
        const raw = input.storage.read();
        if (raw !== undefined && raw !== null) {
          const parsed = recordSchema.parse(copy(raw));
          if (!same(parsed.target, target) || parsed.channel !== input.channel || parsed.kind !== input.kind) throw Error('public_original_context_changed');
          record = parsed;
        }
      } catch { usable = false; status = 'unavailable'; emit(); return snapshot(); }
      return work(read);
    },
    refresh: () => work(read),
    async prepare() {
      if (!snapshot().canPrepare) return record ? work(read) : snapshot();
      return work(async () => {
        const issued = aiClientPublicSessionResponseSchema.parse(await input.api.issueSession(target));
        check(); if (Date.parse(issued.expiresAt) <= now()) throw Error('public_ownership_expired');
        const operationKey = key.parse(input.newKey());
        persist({ version: 'ain-public-continuity-session-1', target, channel: input.channel, kind: input.kind,
          ownership: issued, operationKey, original: null, continuation: null });
        knownOriginal = false; status = 'unknown';
        const result = aiClientPublicPreparationResponseSchema.parse(await input.api.prepare({ ...target, operationKey,
          command: { kind: input.kind } }, issued.credential));
        check(); original(result);
      });
    },
    async continueOriginal() {
      if (!snapshot().canContinue) return record?.continuation ? work(read) : snapshot();
      return work(async () => {
        check(); const client = input.client();
        if (!record?.original || !client?.current()) throw Error('public_client_missing');
        const operationKey = key.parse(input.newKey()), proof = record.original;
        persist({ ...record, continuation: { ownerKey: client.ownerKey, operationKey, receipt: null } }); status = 'unknown';
        if (!client.current() || input.client()?.ownerKey !== client.ownerKey) throw Error('public_client_changed');
        const value = aiClientPublicContinuationResponseSchema.parse(await input.api.continueOriginal({ ...target,
          publicRef: proof.publicRef, expectedMaterialHash: proof.materialHash, operationKey, decision: 'continue_public_request' }, record.ownership.credential));
        check(); if (!client.current() || input.client()?.ownerKey !== client.ownerKey) throw Error('public_client_changed');
        continuation(value, client.ownerKey);
      });
    },
    dispose() { active = false; status = 'closed'; },
  });
}
