import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext, type AiKnowledgeChunkDraft, type AiKnowledgeDocumentDraft, type AiKnowledgeSourceDraft, type AiFactReference } from '@rental-os/shared';
import type { KnowledgeAuthorizationPort, KnowledgeClock, KnowledgeContentPort, KnowledgeRepositoryPort, KnowledgeSearchPort } from './knowledge.ports';
import { requiredPort, unavailable } from './knowledge-errors';
import { authorize, documentSourceSchema, fingerprint, id, parse, parsePersisted, sameScope, scopeSchema, validateChunks, visible } from './knowledge-validation';

type Source = Extract<AiKnowledgeSourceDraft, { kind: 'document' }>;
type ReadDb = Pick<PrismaClient, 'aiKnowledgeChunk'>;
const chunkSchema: z.ZodType<AiKnowledgeChunkDraft> = documentSourceSchema.omit({ kind: true }).extend({
  draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), text: z.string().min(1).max(2000), trust: z.literal('untrusted_data')
}).strict();
const searchSchema = z.object({
  grant: z.object({ scope: scopeSchema, actor: z.object({ actorKind: z.enum(['user', 'saas_admin', 'customer', 'automation']), actorId: id }).strict(),
    audience: z.enum(['operator', 'staff', 'client', 'automation']), accessKey: z.string().min(1).max(256) }).strict(),
  documents: z.array(z.object({ documentId: id, documentVersion: id, aclRevision: z.number().int().positive().max(4294967294) }).strict()).max(100),
  query: z.string().trim().min(1).max(1000), limit: z.number().int().min(1).max(20)
}).strict();

/** Internal read ports, not an HTTP/authentication entry. Search accepts ONLY
 * the grant/allow-list produced by KnowledgeRetrievalService's current selection.
 * SQL limits identity scope and version before any body is read. Lexical only.
 */
export class PrismaKnowledgeReadAdapter implements KnowledgeContentPort, KnowledgeSearchPort {
  constructor(private readonly db: ReadDb, private readonly repository: KnowledgeRepositoryPort,
    private readonly authorization: KnowledgeAuthorizationPort, private readonly clock: KnowledgeClock) {
    requiredPort(db?.aiKnowledgeChunk, ['findMany']); requiredPort(repository, ['read']);
    requiredPort(authorization, ['authorize']); requiredPort(clock, ['now']);
  }

  private where(document: AiKnowledgeDocumentDraft, published = true) {
    if (document.scope.kind !== 'workspace') return unavailable();
    return { version: { documentId: document.documentId, contentHash: document.documentVersion,
      document: { id: document.documentId, tenantId: document.scope.tenantId, workspaceId: document.scope.workspaceId, ...(published ? { status: 'published' } : {}) } } };
  }

  private async head(scope: AiExecutionContext['scope'], documentId: string) {
    const record = await this.repository.read(scope, documentId);
    const now = this.clock.now();
    if (!record || !sameScope(scope, record.document.scope) || !Number.isFinite(now) || !visible(record.document, now)) return unavailable();
    return record;
  }

  private async rows(document: AiKnowledgeDocumentDraft, query?: string, published = true) {
    const rows = await this.db.aiKnowledgeChunk.findMany({ where: { ...this.where(document, published), ...(query === undefined ? {} : { text: { contains: query } }) },
      take: 201, orderBy: [{ chunkIndex: 'asc' }, { id: 'asc' }] });
    if (!Array.isArray(rows) || rows.length > 200) return unavailable();
    let chars = 0;
    const chunks = rows.map(row => {
      const chunk = parsePersisted(chunkSchema, row.state);
      if (row.text !== chunk.text || !Number.isInteger(row.chunkIndex) || row.chunkIndex < 0) return unavailable();
      chars += chunk.text.length;
      return chunk;
    });
    if (chars > 200000) return unavailable();
    if (chunks.length) validateChunks(document, chunks);
    return chunks;
  }

  async chunk(context: AiExecutionContext, input: Source, maxChars: number): Promise<AiKnowledgeChunkDraft | null> {
    try {
      context = structuredClone(context);
      const source = parse(documentSourceSchema, input);
      if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 2000 || !sameScope(context.scope, source.scope)) return unavailable();
      await authorize(this.authorization, context, { action: 'read_body', scope: source.scope });
      const before = await this.head(source.scope, source.documentId), d = before.document;
      if (d.documentVersion !== source.documentVersion || d.aclRevision !== source.aclRevision) return unavailable();
      const grant = await authorize(this.authorization, context, { action: 'read_body', scope: source.scope, document: d });
      const chunks = await this.rows(d);
      const chunk = chunks.find(c => c.chunkId === source.chunkId);
      if (!chunk) return null;
      if (chunk.text.length > maxChars || fingerprint(chunk.locator) !== fingerprint(source.locator)) return unavailable();
      const after = await this.head(source.scope, source.documentId);
      const current = await authorize(this.authorization, context, { action: 'read_body', scope: source.scope, document: after.document });
      if (fingerprint(before) !== fingerprint(after) || fingerprint(grant) !== fingerprint(current)) return unavailable();
      return chunk;
    } catch { return unavailable(); }
  }

  /** Bounded references for a human preview. The caller must still use chunk()
   * for each body read, so a reference list never grants body access. */
  async listSources(context: AiExecutionContext, document: AiKnowledgeDocumentDraft, limit: number) {
    try {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) return unavailable();
      if (!sameScope(context.scope, document.scope)) return unavailable();
      const record = await this.head(document.scope, document.documentId);
      if (fingerprint(record.document) !== fingerprint(document)) return unavailable();
      const grant = await authorize(this.authorization, context, { action: 'read_body', scope: context.scope, document });
      const chunks = await this.rows(document, undefined, false);
      const after = await this.head(document.scope, document.documentId);
      const current = await authorize(this.authorization, context, { action: 'read_body', scope: context.scope, document: after.document });
      if (fingerprint(record) !== fingerprint(after) || fingerprint(grant) !== fingerprint(current)) return unavailable();
      const refs = chunks.slice(0, limit).map(chunk => ({ kind: 'document' as const, documentId: chunk.documentId,
        documentVersion: chunk.documentVersion, chunkId: chunk.chunkId, scope: chunk.scope,
        aclRevision: chunk.aclRevision, locator: chunk.locator }));
      return { refs, truncated: chunks.length > limit };
    } catch { return unavailable(); }
  }

  /** Parsed draft preview is intentionally separate from searchable chunk().
   * It still requires current body authorization and the persisted head. */
  async previewChunks(context: AiExecutionContext, document: AiKnowledgeDocumentDraft, limit: number) {
    try {
      if (!Number.isInteger(limit) || limit < 1 || limit > 10 || !sameScope(context.scope, document.scope)) return unavailable();
      const record = await this.repository.read(document.scope, document.documentId);
      if (!record || fingerprint(record.document) !== fingerprint(document) || document.parsing !== 'parsed'
        || document.publication === 'deleted' || document.publication === 'withdrawn') return unavailable();
      const grant = await authorize(this.authorization, context, { action: 'read_body', scope: context.scope, document });
      const chunks = await this.rows(document, undefined, false);
      const after = await this.repository.read(document.scope, document.documentId);
      if (!after || fingerprint(record) !== fingerprint(after)) return unavailable();
      const current = await authorize(this.authorization, context, { action: 'read_body', scope: context.scope, document: after.document });
      if (fingerprint(grant) !== fingerprint(current)) return unavailable();
      return { chunks: chunks.slice(0, limit), truncated: chunks.length > limit };
    } catch { return unavailable(); }
  }

  async search(value: Parameters<KnowledgeSearchPort['search']>[0]): ReturnType<KnowledgeSearchPort['search']> {
    const input = parse(searchSchema, value);
    try {
      if (input.grant.scope.kind !== 'workspace') return unavailable();
      const result: Source[] = [], seen = new Set<string>();
      let chars = 0;
      for (const ref of input.documents) {
        if (seen.has(ref.documentId)) return unavailable();
        seen.add(ref.documentId);
        const before = await this.head(input.grant.scope, ref.documentId), d = before.document;
        if (d.documentVersion !== ref.documentVersion || d.aclRevision !== ref.aclRevision) return unavailable();
        const chunks = await this.rows(d, input.query);
        for (const c of chunks) {
          chars += c.text.length;
          if (chars > 200000) return unavailable();
          // SQL collation may be case-insensitive. No natural-language instruction
          // is interpreted; only reference metadata leaves this port.
          if (c.text.includes(input.query) && result.length < input.limit) result.push({ kind: 'document', documentId: c.documentId, documentVersion: c.documentVersion,
            chunkId: c.chunkId, scope: c.scope, aclRevision: c.aclRevision, locator: c.locator });
        }
        if (fingerprint(before) !== fingerprint(await this.head(input.grant.scope, ref.documentId))) return unavailable();
      }
      return result;
    } catch { return unavailable(); }
  }

  async downloadReference(context: AiExecutionContext, document: AiKnowledgeDocumentDraft) {
    try {
      context = structuredClone(context); document = structuredClone(document);
      if (!sameScope(context.scope, document.scope)) return unavailable();
      const before = await this.head(document.scope, document.documentId);
      if (fingerprint(before.document) !== fingerprint(document)) return unavailable();
      const grant = await authorize(this.authorization, context, { action: 'download', scope: document.scope, document });
      const after = await this.head(document.scope, document.documentId);
      const current = await authorize(this.authorization, context, { action: 'download', scope: document.scope, document: after.document });
      if (fingerprint(before) !== fingerprint(after) || fingerprint(grant) !== fingerprint(current)) return unavailable();
      return { attachmentId: document.attachmentId, documentVersion: document.documentVersion };
    } catch { return unavailable(); }
  }

  async factReference(_context: AiExecutionContext, _fact: AiFactReference): Promise<AiFactReference | null> {
    // Realtime Core facts require their own authorized resolver, never a knowledge index.
    return unavailable();
  }
}
