import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeDocumentPorts, KnowledgeRecord, KnowledgeAction } from './knowledge.ports';
import { KnowledgeCommitUnknownError, KnowledgeError, requiredPort } from './knowledge-errors';
import { assertRecord, authorize, draftInput, fingerprint, mutationInput, operationFingerprint, parse, validateChunks, queueIndex } from './knowledge-validation';

export class KnowledgeDocumentService {
  constructor(readonly ports: KnowledgeDocumentPorts) {
    requiredPort(ports?.repository, ['read', 'operation', 'commit']);
    requiredPort(ports?.authorization, ['authorize']); requiredPort(ports?.clock, ['now']);
    requiredPort(ports?.files, ['read']); requiredPort(ports?.parser, ['parse']);
  }

  async read(context: AiExecutionContext, documentId: string): Promise<KnowledgeRecord> {
    return this.load(context, documentId, 'read_metadata');
  }

  async load(context: AiExecutionContext, documentId: string, action: KnowledgeAction): Promise<KnowledgeRecord> {
    const contextHash = fingerprint(context);
    const stableContext = structuredClone(context);
    await authorize(this.ports.authorization, stableContext, { action, scope: stableContext.scope });
    if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
    const record = await this.ports.repository.read(stableContext.scope, documentId);
    assertRecord(record, stableContext.scope, documentId);
    if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
    await authorize(this.ports.authorization, stableContext, { action, scope: stableContext.scope, document: record.document });
    if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
    return structuredClone(record);
  }

  async replay(context: AiExecutionContext, record: KnowledgeRecord, operationId: string, hash: string): Promise<boolean> {
    const receipt = await this.ports.repository.operation(context.scope, record.document.documentId, operationId);
    if (!receipt) return false;
    if (receipt.fingerprint !== hash) throw new KnowledgeError('conflict');
    return true;
  }

  private async assertAttachmentBound(context: AiExecutionContext, documentId: string, attachmentId: string) {
    if (!this.ports.files.assertBound) return;
    if (context.scope.kind !== 'workspace') throw new KnowledgeError('unavailable');
    const workspaceId = context.scope.workspaceId;
    const contextHash = fingerprint(context), stable = structuredClone(context), stableHash = fingerprint(stable);
    await this.ports.files.assertBound(stable, { attachmentId, documentId, workspaceId });
    if (fingerprint(context) !== contextHash || fingerprint(stable) !== stableHash) throw new KnowledgeError('unavailable');
  }

  async save(context: AiExecutionContext, action: KnowledgeAction, before: KnowledgeRecord, next: KnowledgeRecord, operationId: string, hash: string, newVersion = false): Promise<KnowledgeRecord> {
    const contextHash = fingerprint(context);
    const stableContext = structuredClone(context);
    const stableContextHash = fingerprint(stableContext);
    const assertStableContext = () => {
      if (fingerprint(context) !== contextHash || fingerprint(stableContext) !== stableContextHash) throw new KnowledgeError('unavailable');
    };
    await authorize(this.ports.authorization, structuredClone(stableContext), { action, scope: structuredClone(stableContext.scope), document: structuredClone(before.document) });
    assertStableContext();
    const result = await this.ports.repository.commit({ scope: structuredClone(stableContext.scope), documentId: next.document.documentId, expectedRevision: before.revision, operation: { id: operationId, fingerprint: hash, ...(next.failure ? { failure: next.failure } : {}) }, next: structuredClone(next), newVersion });
    assertStableContext();
    if (result !== 'committed') throw new KnowledgeError('conflict');
    this.ports.cache?.invalidate(structuredClone(stableContext.scope), next.document.documentId);
    return this.load(stableContext, next.document.documentId, action);
  }

  async create(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(draftInput, value);
    const grant = await authorize(this.ports.authorization, context, { action: 'create', scope: context.scope, attachmentId: input.attachmentId });
    // The create entry itself must enforce the same business-file binding as
    // prepareCreate. A caller may invoke this service directly, so the
    // preparation check cannot be the only guard before persistence.
    await this.assertAttachmentBound(context, input.documentId, input.attachmentId);
    const hash = operationFingerprint(context, ['create', input]);
    const existing = await this.ports.repository.read(context.scope, input.documentId);
    if (existing) {
      const record = await this.load(context, input.documentId, 'create');
      if (await this.replay(context, record, input.operationId, hash)) return record;
      throw new KnowledgeError('conflict');
    }
    const document = { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, documentId: input.documentId, documentVersion: input.documentVersion, attachmentId: input.attachmentId, owner: grant.actor, scope: grant.scope, aclRevision: 1, title: input.title, publication: 'draft' as const, parsing: 'pending' as const, indexing: 'not_indexed' as const, validFrom: input.validFrom, ...(input.validUntil ? { validUntil: input.validUntil } : {}) };
    await authorize(this.ports.authorization, context, { action: 'create', scope: context.scope, document, attachmentId: input.attachmentId });
    const result = await this.ports.repository.commit({ scope: context.scope, documentId: input.documentId, expectedRevision: 0, operation: { id: input.operationId, fingerprint: hash }, next: { document, revision: 1 }, newVersion: true });
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.load(context, input.documentId, 'create');
  }

  async newVersion(context: AiExecutionContext, expectedRevision: number, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(draftInput, value);
    parse(mutationInput, { documentId: input.documentId, expectedRevision, operationId: input.operationId });
    const before = await this.load(context, input.documentId, 'revise'), hash = operationFingerprint(context, ['revise', expectedRevision, input]);
    if (await this.replay(context, before, input.operationId, hash)) return before;
    // A pending parse receipt may have committed while its reply was lost.
    // Do not erase that unresolved boundary by admitting a replacement version.
    if (before.parseOperationId) throw new KnowledgeCommitUnknownError();
    if (before.revision !== expectedRevision || before.document.publication === 'deleted' || before.document.documentVersion === input.documentVersion) throw new KnowledgeError('conflict');
    await authorize(this.ports.authorization, context, { action: 'revise', scope: context.scope, document: before.document, attachmentId: input.attachmentId });
    await this.assertAttachmentBound(context, input.documentId, input.attachmentId);
    const { validUntil: oldExpiry, ...previous } = before.document;
    const next: KnowledgeRecord = { revision: before.revision + 1, document: { ...previous, documentVersion: input.documentVersion, attachmentId: input.attachmentId, title: input.title, validFrom: input.validFrom, ...(input.validUntil ? { validUntil: input.validUntil } : {}), publication: 'draft', parsing: 'pending', indexing: 'not_indexed' } };
    return this.save(context, 'revise', before, queueIndex(next, 'remove', `${input.operationId}:index`), input.operationId, hash, true);
  }

  async parseDocument(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const callerContextHash = fingerprint(context);
    const stableContext = structuredClone(context);
    const stableContextHash = fingerprint(stableContext);
    const assertStableContext = () => {
      if (fingerprint(context) !== callerContextHash || fingerprint(stableContext) !== stableContextHash) throw new KnowledgeError('unavailable');
    };
    const input = parse(mutationInput, value), before = await this.load(stableContext, input.documentId, 'parse');
    assertStableContext();
    const hash = operationFingerprint(stableContext, ['parse', input]);
    if (await this.replay(stableContext, before, input.operationId, hash)) {
      assertStableContext();
      // The pending operation receipt acknowledges admission only, not parsed
      // chunks. Never restart parsing or report a completed replay on that basis.
      if (before.parseOperationId === input.operationId) throw new KnowledgeCommitUnknownError();
      return before;
    }
    assertStableContext();
    if (before.revision !== input.expectedRevision || before.document.publication !== 'draft' || before.document.parsing === 'parsed' || before.parseOperationId) throw new KnowledgeError('conflict');
    const pending: KnowledgeRecord = { indexJob: before.indexJob && structuredClone(before.indexJob), document: { ...structuredClone(before.document), parsing: 'pending', indexing: 'not_indexed' }, revision: before.revision + 1, parseOperationId: input.operationId };
    await this.save(stableContext, 'parse', before, pending, input.operationId, hash);
    assertStableContext();
    let chunks;
    let failure: KnowledgeRecord['failure'];
    try {
      await authorize(this.ports.authorization, structuredClone(stableContext), { action: 'read_body', scope: structuredClone(stableContext.scope), document: structuredClone(pending.document), attachmentId: pending.document.attachmentId });
      assertStableContext();
      const file = await this.ports.files.read(structuredClone(stableContext), structuredClone(pending.document), 262144);
      assertStableContext();
      if (!file || typeof file.mediaType !== 'string' || !(file.bytes instanceof Uint8Array)) throw new KnowledgeError('invalid_text');
      if (file.bytes.byteLength > 262144) throw new KnowledgeError('limit_exceeded');
      chunks = this.ports.parser.parse(structuredClone(pending.document), structuredClone(file));
      validateChunks(pending.document, chunks);
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'unavailable') throw error;
      failure = error instanceof KnowledgeError && ['unsupported', 'invalid_text', 'empty_text', 'limit_exceeded'].includes(error.code) ? error.code as KnowledgeRecord['failure'] : 'parse_failed';
    }
    await authorize(this.ports.authorization, structuredClone(stableContext), { action: 'parse', scope: structuredClone(stableContext.scope), document: structuredClone(pending.document) });
    assertStableContext();
    const next: KnowledgeRecord = { indexJob: pending.indexJob, revision: pending.revision + 1, document: { ...pending.document, parsing: failure ? (failure === 'parse_failed' ? 'failed' : 'rejected') : 'parsed' }, ...(failure ? { failure } : {}) };
    const result = await this.ports.repository.commit({ scope: structuredClone(stableContext.scope), documentId: input.documentId, expectedRevision: pending.revision, operation: { id: `${input.operationId}:parse-result`, fingerprint: fingerprint(['parse-result', hash, failure ?? 'parsed']), ...(failure ? { failure } : {}) }, next: structuredClone(next), ...(failure ? {} : { chunks: structuredClone(chunks) }), newVersion: false });
    assertStableContext();
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.load(stableContext, input.documentId, 'parse');
  }

  /** Read-only reconciliation of this exact operation, not permission to retry
   * parsing. A pending receipt proves admission only. Later document mutations
   * must be read separately; they are not the historical parse result.
   */
  async reconcileParse(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const contextHash = fingerprint(context), stable = structuredClone(context);
    const check = () => {
      if (fingerprint(context) !== contextHash || fingerprint(stable) !== contextHash) throw new KnowledgeError('unavailable');
    };
    const input = parse(mutationInput, value);
    const before = await this.load(stable, input.documentId, 'parse');
    check();
    const hash = operationFingerprint(stable, ['parse', input]);
    if (!await this.replay(stable, before, input.operationId, hash)) throw new KnowledgeError('not_ready');
    check();
    const result = await this.ports.repository.operation(structuredClone(stable.scope), input.documentId, `${input.operationId}:parse-result`);
    check();
    const after = await this.load(stable, input.documentId, 'parse');
    check();
    if (fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
    if (!result) throw new KnowledgeCommitUnknownError();
    if (result.fingerprint !== fingerprint(['parse-result', hash, result.failure ?? 'parsed'])) throw new KnowledgeError('conflict');
    if (after.parseOperationId || after.revision !== input.expectedRevision + 2 || after.document.publication !== 'draft') throw new KnowledgeError('conflict');
    const expected = result.failure ? result.failure === 'parse_failed' ? 'failed' : 'rejected' : 'parsed';
    if (after.document.parsing !== expected || after.failure !== result.failure) throw new KnowledgeError('unavailable');
    return structuredClone(after);
  }
}
