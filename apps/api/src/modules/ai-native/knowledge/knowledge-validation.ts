import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext, type AiExecutionScope, type AiKnowledgeChunkDraft, type AiKnowledgeDocumentDraft } from '@rental-os/shared';
import type { KnowledgeAuthorizationPort, KnowledgeAuthorizationRequest, KnowledgeGrant, KnowledgeRecord } from './knowledge.ports';
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
    const grant = await port.authorize(context, request);
    const owner = actor(context);
    if (!grant || !sameScope(context.scope, request.scope) || !sameScope(grant.scope, request.scope) || grant.audience !== context.audience || grant.actor.actorKind !== owner.actorKind || grant.actor.actorId !== owner.actorId || !grant.accessKey || grant.accessKey.length > 256) unavailable();
    return grant;
  } catch { return unavailable(); }
}
export function queueIndex(record: KnowledgeRecord, kind: 'upsert' | 'remove', operationId: string): KnowledgeRecord {
  return { ...record, indexJob: { operationId, kind, status: 'pending', documentVersion: record.document.documentVersion, aclRevision: record.document.aclRevision, generation: record.revision } };
}
export function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
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
