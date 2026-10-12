import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext, type AiExecutionScope, type AiKnowledgeChunkDraft, type AiKnowledgeDocumentDraft, type AiMemoryDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { KnowledgeAuthorizationPort, KnowledgeAuthorizationRequest, KnowledgeGrant, KnowledgeRecord, MemoryConfirmation } from './knowledge.ports';
import { KnowledgeError, unavailable } from './knowledge-errors';

export const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('platform') }).strict(),
  z.object({ kind: z.literal('tenant'), tenantId: id }).strict(),
  z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
]);
const time = z.string().datetime({ offset: true });
const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), page: z.number().int().min(1).max(100000), paragraph: z.number().int().min(1).max(100000) }).strict(),
  z.object({ kind: z.literal('section'), sectionId: id, paragraph: z.number().int().min(1).max(100000) }).strict(),
]);
export const documentSourceSchema = z.object({ kind: z.literal('document'), documentId: id, documentVersion: id, chunkId: id, scope: scopeSchema, aclRevision: z.number().int().positive(), locator: locatorSchema }).strict();
export const factSchema = z.object({ scope: scopeSchema, resourceType: z.enum(['order', 'quote', 'configuration', 'report', 'inspection', 'knowledge']), resourceId: id, observedAt: time, basis: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current') }).strict(), z.object({ kind: z.literal('snapshot'), version: id }).strict(),
  z.object({ kind: z.literal('missing'), reason: z.enum(['snapshot_missing', 'source_unavailable']) }).strict(),
  z.object({ kind: z.literal('legacy_current_fallback'), reason: z.literal('snapshot_missing') }).strict(),
]) }).strict();
export const draftInput = z.object({ documentId: id, documentVersion: id, attachmentId: id, title: z.string().min(1).max(256), validFrom: time, validUntil: time.optional(), operationId: id }).strict().refine(v => !v.validUntil || Date.parse(v.validUntil) > Date.parse(v.validFrom));
export const mutationInput = z.object({ documentId: id, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1), operationId: id }).strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new KnowledgeError('invalid_input');
  return result.data;
}
export function scopeKey(scope: AiExecutionScope): string { return JSON.stringify(parse(scopeSchema, scope)); }
export function sameScope(a: AiExecutionScope, b: AiExecutionScope): boolean { return scopeKey(a) === scopeKey(b); }
export function actor(context: AiExecutionContext) {
  const a = context.actor;
  return { actorKind: a.kind, actorId: a.kind === 'customer' ? a.customerId : a.kind === 'automation' ? a.subjectId : a.userId };
}
export async function authorize(port: KnowledgeAuthorizationPort, context: AiExecutionContext, request: KnowledgeAuthorizationRequest): Promise<KnowledgeGrant> {
  try {
    parse(scopeSchema, context.scope);
    const contextHash = fingerprint(context), requestHash = fingerprint(request);
    const stableContext = structuredClone(context), stableRequest = structuredClone(request);
    const answer = await port.authorize(stableContext, stableRequest);
    if (fingerprint(context) !== contextHash || fingerprint(request) !== requestHash || fingerprint(stableContext) !== contextHash || fingerprint(stableRequest) !== requestHash) unavailable();
    const grant = answer ? structuredClone(answer) : null;
    const owner = actor(stableContext);
    if (!grant || !sameScope(stableContext.scope, stableRequest.scope) || !sameScope(grant.scope, stableRequest.scope) || grant.audience !== stableContext.audience || grant.actor.actorKind !== owner.actorKind || grant.actor.actorId !== owner.actorId || typeof grant.accessKey !== 'string' || !grant.accessKey || grant.accessKey.length > 256) unavailable();
    return grant;
  } catch { return unavailable(); }
}
export function queueIndex(record: KnowledgeRecord, kind: 'upsert' | 'remove', operationId: string): KnowledgeRecord {
  return { ...record, indexJob: { operationId, kind, status: 'pending', documentVersion: record.document.documentVersion, aclRevision: record.document.aclRevision, generation: record.revision } };
}
export function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function operationFingerprint(context: AiExecutionContext, value: unknown): string {
  return fingerprint(['knowledge-operation-v1', { scope: structuredClone(context.scope), actor: actor(context), audience: context.audience }, value]);
}
export function visible(document: AiKnowledgeDocumentDraft, now: number): boolean {
  return document.publication === 'published' && document.parsing === 'parsed' && document.indexing === 'indexed' && Date.parse(document.validFrom) <= now && (!document.validUntil || now < Date.parse(document.validUntil));
}
export function assertRecord(record: KnowledgeRecord | null, scope: AiExecutionScope, documentId: string): asserts record is KnowledgeRecord {
  if (!record || record.document.documentId !== documentId || !sameScope(scope, record.document.scope)) unavailable();
}
export function validateChunks(document: AiKnowledgeDocumentDraft, chunks: AiKnowledgeChunkDraft[]): void {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 200) throw new KnowledgeError('limit_exceeded');
  const ids = new Set<string>(); let chars = 0;
  for (const c of chunks) {
    const loc = c.locator;
    if (c.draftVersion !== AI_KNOWLEDGE_DRAFT_VERSION || c.documentId !== document.documentId || c.documentVersion !== document.documentVersion || !sameScope(c.scope, document.scope) || c.aclRevision !== document.aclRevision || c.trust !== 'untrusted_data' || !id.safeParse(c.chunkId).success || ids.has(c.chunkId) || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || !loc || !Number.isSafeInteger(loc.paragraph) || loc.paragraph < 1 || (loc.kind === 'section' ? !id.safeParse(loc.sectionId).success : loc.kind !== 'page' || !Number.isSafeInteger(loc.page) || loc.page < 1)) throw new KnowledgeError('invalid_input');
    ids.add(c.chunkId); chars += c.text.length;
  }
  if (chars > 200000) throw new KnowledgeError('limit_exceeded');
}

/** Shared persisted-body contract for current and historical content readers. */
export const persistedKnowledgeChunkSchema: z.ZodType<AiKnowledgeChunkDraft> = documentSourceSchema.omit({ kind: true }).extend({
  draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), text: z.string().min(1).max(2000), trust: z.literal('untrusted_data')
}).strict();

const persistedRevision = z.number().int().min(1).max(4294967294);
const ownerSchema = z.object({ actorKind: z.enum(['user', 'saas_admin', 'customer', 'automation']), actorId: id }).strict();
export const preferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('locale'), value: z.enum(['zh-CN', 'en-US']) }).strict(),
  z.object({ kind: z.literal('fulfillment_location'), locationId: id }).strict(),
  z.object({ kind: z.literal('display_density'), value: z.enum(['comfortable', 'compact']) }).strict(),
]);
export const confirmationSchema: z.ZodType<MemoryConfirmation> = z.object({
  id, memoryId: id, revision: persistedRevision, aclRevision: persistedRevision, owner: ownerSchema, scope: scopeSchema,
  audience: z.enum(['operator', 'staff', 'client', 'automation']), preference: preferenceSchema, memoryExpiresAt: time,
  status: z.enum(['confirmed', 'revoked']), issuedAt: time, expiresAt: time
}).strict();
const memoryBase = { draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id, revision: persistedRevision, owner: ownerSchema,
  scope: scopeSchema, aclRevision: persistedRevision, expiresAt: time };
export const memoryDraftSchema: z.ZodType<AiMemoryDraft> = z.discriminatedUnion('status', [
  z.object({ ...memoryBase, status: z.literal('proposed'), preference: preferenceSchema }).strict(),
  z.object({ ...memoryBase, status: z.literal('confirmed'), preference: preferenceSchema, confirmationRecordId: id }).strict(),
  z.object({ ...memoryBase, status: z.literal('deleted'), deletedAt: time }).strict()
]);
const documentSchema = z.object({
  draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), documentId: id, documentVersion: id, attachmentId: id, owner: ownerSchema,
  scope: scopeSchema, aclRevision: persistedRevision, title: z.string().min(1).max(256),
  publication: z.enum(['draft', 'published', 'withdrawn', 'deleted']), parsing: z.enum(['pending', 'parsed', 'failed', 'rejected']),
  indexing: z.enum(['not_indexed', 'indexing', 'indexed', 'failed']), validFrom: time, validUntil: time.optional()
}).strict().refine(value => !value.validUntil || Date.parse(value.validUntil) > Date.parse(value.validFrom));
export const knowledgeFailureSchema = z.enum(['parse_failed', 'unsupported', 'invalid_text', 'empty_text', 'limit_exceeded', 'index_failed']);
export const knowledgeRecordSchema: z.ZodType<KnowledgeRecord> = z.object({
  document: documentSchema, revision: persistedRevision, parseOperationId: id.optional(), failure: knowledgeFailureSchema.optional(),
  indexJob: z.object({ operationId: z.string().min(1).max(191), documentVersion: id, aclRevision: persistedRevision,
    generation: persistedRevision, kind: z.enum(['upsert', 'remove']), status: z.enum(['pending', 'completed', 'failed']) }).strict().optional()
}).strict().refine(value => !value.indexJob || value.indexJob.documentVersion === value.document.documentVersion
  && value.indexJob.aclRevision === value.document.aclRevision && value.indexJob.generation <= value.revision);
export function parsePersisted<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return unavailable();
  return parsed.data;
}
export function memoryConfirmationHash(proof: MemoryConfirmation): string {
  return requestFingerprint(['structured-memory-confirmation-v1', { memoryId: proof.memoryId, revision: proof.revision, aclRevision: proof.aclRevision,
    owner: proof.owner, scope: proof.scope, audience: proof.audience, preference: proof.preference, memoryExpiresAt: proof.memoryExpiresAt,
    issuedAt: proof.issuedAt, expiresAt: proof.expiresAt }]);
}
