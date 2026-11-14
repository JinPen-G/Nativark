import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeDocumentPorts, KnowledgeRecord, KnowledgeAction, KnowledgeAuthorizationRequest, KnowledgeRepositoryPort } from './knowledge.ports';
import { KnowledgeCommitUnknownError, KnowledgeError, requiredPort } from './knowledge-errors';
import { assertRecord, authorize, draftInput, fingerprint, mutationInput, operationFingerprint, parse, validateChunks, queueIndex } from './knowledge-validation';
import { inspectRetentionSource, lockRetentionSourceScope, retentionSourceCopies } from '../privacy/retention-model-sources';

/** Server-only binding to the ORIGINAL repository transaction. The caller
 * supplies its transaction-bound repository, not another storage/runtime chain.
 * The server composition owns this port; HTTP and model input never supply it. */
export interface KnowledgeDocumentRetention {
  withTransaction<T>(work: (tx: Prisma.TransactionClient, repository: KnowledgeRepositoryPort) => Promise<T>): Promise<T>;
}

/** Original document lifecycle/CAS and read authorization. Explicit deletion
 * checks retained source evidence in the same scope-locked transaction. Logical
 * withdrawal/ACL changes still stop reads immediately without erasing bodies. */
export class KnowledgeDocumentService {
  constructor(readonly ports: KnowledgeDocumentPorts, private readonly retention?: KnowledgeDocumentRetention) {
    requiredPort(ports?.repository, ['read', 'operation', 'commit']);
    requiredPort(ports?.authorization, ['authorize']); requiredPort(ports?.clock, ['now']);
    requiredPort(ports?.files, ['read']); requiredPort(ports?.parser, ['parse']);
  }

  /** Supplied file service => the binding check is mandatory, not optional. */
  private bindingCheckMandatory(): boolean {
    return this.ports.attachmentBindingRequired === true;
  }

  async read(context: AiExecutionContext, documentId: string): Promise<KnowledgeRecord> {
    return this.load(context, documentId, 'read_metadata');
  }

  async load(context: AiExecutionContext, documentId: string, action: KnowledgeAction,
    binding: Pick<KnowledgeAuthorizationRequest, 'lifecycle' | 'receiptOperationId'> = {}): Promise<KnowledgeRecord> {
    const contextHash = fingerprint(context);
    const stableContext = structuredClone(context);
    await authorize(this.ports.authorization, stableContext, { action, scope: stableContext.scope, ...binding });
    if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
    const record = await this.ports.repository.read(stableContext.scope, documentId);
    assertRecord(record, stableContext.scope, documentId);
    if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
    await authorize(this.ports.authorization, stableContext, { action, scope: stableContext.scope, document: record.document, ...binding });
    if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
    return structuredClone(record);
  }

  async replay(context: AiExecutionContext, record: KnowledgeRecord, operationId: string, hash: string): Promise<boolean> {
    const receipt = await this.ports.repository.operation(context.scope, record.document.documentId, operationId);
    if (!receipt) return false;
    if (receipt.fingerprint !== hash) throw new KnowledgeError('conflict');
    return true;
  }

  private async commitDeletion(context: AiExecutionContext, action: KnowledgeAction, before: KnowledgeRecord,
    input: Parameters<KnowledgeRepositoryPort['commit']>[0], binding: Pick<KnowledgeAuthorizationRequest, 'lifecycle'>) {
    // Replay observes the same immutable operation even after holds/dependencies
    // change. It cannot authorize another deletion or erase a pending parse.
    const receipt = await this.ports.repository.operation(input.scope, input.documentId, input.operation.id);
    if (receipt) {
      if (receipt.fingerprint !== input.operation.fingerprint) throw new KnowledgeError('conflict');
      return 'committed' as const;
    }
    if (before.parseOperationId) throw new KnowledgeCommitUnknownError();
    if (typeof this.retention?.withTransaction !== 'function') {
      throw Object.assign(new KnowledgeError('unavailable'), { reason: 'source_retention_not_assembled' });
    }
    const contextHash = fingerprint(context), beforeHash = fingerprint(before);
    let attempted = false, completed = false;
    try {
      return await this.retention.withTransaction(async (tx, repository) => {
        const { scopeId, owner } = await lockRetentionSourceScope(tx, context.scope);
        const original = await repository.operation(input.scope, input.documentId, input.operation.id);
        if (original) {
          if (original.fingerprint !== input.operation.fingerprint) throw new KnowledgeError('conflict');
          await authorize(this.ports.authorization, context, { action, scope: context.scope, document: before.document, ...binding });
          if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
          completed = true;
          return 'committed' as const;
        }
        const current = await repository.read(input.scope, input.documentId);
        if (!current || fingerprint(current) !== beforeHash) throw new KnowledgeError('conflict');
        const state = await inspectRetentionSource(tx, scopeId, 'knowledge', input.documentId, owner);
        if (state !== 'clear') throw Object.assign(new KnowledgeError(state === 'held' ? 'not_ready' : 'unavailable'), {
          reason: state === 'held' ? 'referenced_by_unresolved_task' : 'source_task_binding_unavailable',
        });
        // Logical source CAS cannot rewrite immutable Task input/result bodies.
        // Keep the original source until that existing copy consumer is wired;
        // neither a terminal Task nor a queued index remove is deletion proof.
        if ((await retentionSourceCopies(tx, scopeId, 'knowledge', input.documentId, owner)).length) {
          throw Object.assign(new KnowledgeError('unavailable'), { reason: 'source_copy_erasure_not_assembled' });
        }
        await authorize(this.ports.authorization, context, { action, scope: context.scope, document: current.document, ...binding });
        if (fingerprint(context) !== contextHash || fingerprint(await repository.read(input.scope, input.documentId)) !== beforeHash) {
          throw new KnowledgeError('conflict');
        }
        attempted = true;
        const result = await repository.commit(input);
        if (result !== 'committed') throw new KnowledgeError('conflict');
        await authorize(this.ports.authorization, context, { action, scope: context.scope, document: current.document, ...binding });
        if (fingerprint(context) !== contextHash) throw new KnowledgeError('unavailable');
        completed = true;
        return result;
      });
    } catch (error) {
      if (completed) throw new KnowledgeCommitUnknownError();
      if (error instanceof KnowledgeError) throw error;
      if (attempted) throw new KnowledgeCommitUnknownError();
      throw new KnowledgeError('unavailable');
    }
  }

  private async assertAttachmentBound(context: AiExecutionContext, documentId: string, attachmentId: string, selection?: { documentVersion: string; expectedRevision: number }) {
    if (typeof this.ports.files.assertBound !== 'function') throw new KnowledgeError('unavailable');
    if (context.scope.kind !== 'workspace') throw new KnowledgeError('unavailable');
    const workspaceId = context.scope.workspaceId;
    const contextHash = fingerprint(context), stable = structuredClone(context), stableHash = fingerprint(stable);
    await this.ports.files.assertBound(stable, { attachmentId, documentId, workspaceId, ...selection });
    if (fingerprint(context) !== contextHash || fingerprint(stable) !== stableHash) throw new KnowledgeError('unavailable');
  }

  async save(context: AiExecutionContext, action: KnowledgeAction, before: KnowledgeRecord, next: KnowledgeRecord, operationId: string, hash: string,
    newVersion = false, binding: Pick<KnowledgeAuthorizationRequest, 'lifecycle'> = {}): Promise<KnowledgeRecord> {
    const contextHash = fingerprint(context);
    const stableContext = structuredClone(context);
    const stableContextHash = fingerprint(stableContext);
    const assertStableContext = () => {
      if (fingerprint(context) !== contextHash || fingerprint(stableContext) !== stableContextHash) throw new KnowledgeError('unavailable');
    };
    await authorize(this.ports.authorization, structuredClone(stableContext), { action, scope: structuredClone(stableContext.scope), document: structuredClone(before.document), ...binding });
    if (action === 'revise') {
      await this.assertAttachmentBound(stableContext, next.document.documentId, next.document.attachmentId,
        { documentVersion: next.document.documentVersion, expectedRevision: before.revision });
      await authorize(this.ports.authorization, structuredClone(stableContext), { action, scope: structuredClone(stableContext.scope),
        document: structuredClone(before.document), ...binding });
    }
    assertStableContext();
    const input = { scope: structuredClone(stableContext.scope), documentId: next.document.documentId,
      expectedRevision: before.revision, operation: { id: operationId, fingerprint: hash, ...(next.failure ? { failure: next.failure } : {}) },
      next: structuredClone(next), newVersion };
    // Withdrawal, ACL updates and version selection invalidate current reads
    // while keeping historical chunks. Holds cannot defer that revocation.
    const result = action === 'delete' ? await this.commitDeletion(stableContext, action, before, input, binding)
      : await this.ports.repository.commit(input);
    assertStableContext();
    if (result !== 'committed') throw new KnowledgeError('conflict');
    this.ports.cache?.invalidate(structuredClone(stableContext.scope), next.document.documentId);
    return this.load(stableContext, next.document.documentId, action, binding);
  }

  async create(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(draftInput, value);
    const grant = await authorize(this.ports.authorization, context, { action: 'create', scope: context.scope, attachmentId: input.attachmentId, creation: input });
    // An absent byte/file source must not disable lawful metadata creation,
    // but a SUPPLIED file service without its binding check may not admit an
    // unverifiable attachment reference: create then enforces the same
    // binding as prepareCreate and fails closed while the check is missing.
    if (this.bindingCheckMandatory() || typeof this.ports.files?.assertBound === 'function') {
      await this.assertAttachmentBound(context, input.documentId, input.attachmentId);
    }
    const hash = operationFingerprint(context, ['create', input]);
    const existing = await this.ports.repository.read(context.scope, input.documentId);
    if (existing) {
      const record = await this.load(context, input.documentId, 'create');
      if (await this.replay(context, record, input.operationId, hash)) return record;
      throw new KnowledgeError('conflict');
    }
    const document = { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, documentId: input.documentId, documentVersion: input.documentVersion, attachmentId: input.attachmentId, owner: grant.actor, scope: grant.scope, aclRevision: 1, title: input.title, publication: 'draft' as const, parsing: 'pending' as const, indexing: 'not_indexed' as const, validFrom: input.validFrom, ...(input.validUntil ? { validUntil: input.validUntil } : {}) };
    await authorize(this.ports.authorization, context, { action: 'create', scope: context.scope, document, attachmentId: input.attachmentId, creation: input });
    if (this.bindingCheckMandatory() || typeof this.ports.files?.assertBound === 'function') {
      await this.assertAttachmentBound(context, input.documentId, input.attachmentId);
    }
    await authorize(this.ports.authorization, context, { action: 'create', scope: context.scope, document, attachmentId: input.attachmentId, creation: input });
    const result = await this.ports.repository.commit({ scope: context.scope, documentId: input.documentId, expectedRevision: 0, operation: { id: input.operationId, fingerprint: hash }, next: { document, revision: 1 }, newVersion: true });
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.load(context, input.documentId, 'create');
  }

  async newVersion(context: AiExecutionContext, expectedRevision: number, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(draftInput, value);
    parse(mutationInput, { documentId: input.documentId, expectedRevision, operationId: input.operationId });
    const binding = { lifecycle: { action: 'revise' as const, expectedRevision, command: input } };
    const before = await this.load(context, input.documentId, 'revise', binding), hash = operationFingerprint(context, ['revise', expectedRevision, input]);
    if (await this.replay(context, before, input.operationId, hash)) return before;
    // A pending parse receipt may have committed while its reply was lost.
    // Do not erase that unresolved boundary by admitting a replacement version.
    if (before.parseOperationId) throw new KnowledgeCommitUnknownError();
    if (before.revision !== expectedRevision || before.document.publication === 'deleted' || before.document.documentVersion === input.documentVersion) throw new KnowledgeError('conflict');
    await authorize(this.ports.authorization, context, { action: 'revise', scope: context.scope, document: before.document, attachmentId: input.attachmentId, ...binding });
    await this.assertAttachmentBound(context, input.documentId, input.attachmentId, { documentVersion: input.documentVersion, expectedRevision });
    const { validUntil: oldExpiry, ...previous } = before.document;
    const next: KnowledgeRecord = { revision: before.revision + 1, document: { ...previous, documentVersion: input.documentVersion, attachmentId: input.attachmentId, title: input.title, validFrom: input.validFrom, ...(input.validUntil ? { validUntil: input.validUntil } : {}), publication: 'draft', parsing: 'pending', indexing: 'not_indexed' } };
    return this.save(context, 'revise', before, queueIndex(next, 'remove', `${input.operationId}:index`), input.operationId, hash, true, binding);
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
    let contentHash: string | undefined;
    let failure: KnowledgeRecord['failure'];
    try {
      await authorize(this.ports.authorization, structuredClone(stableContext), { action: 'read_body', scope: structuredClone(stableContext.scope), document: structuredClone(pending.document), attachmentId: pending.document.attachmentId });
      assertStableContext();
      const file = await this.ports.files.read(structuredClone(stableContext), structuredClone(pending.document), 262144);
      assertStableContext();
      if (!file || typeof file.mediaType !== 'string' || !(file.bytes instanceof Uint8Array)) throw new KnowledgeError('invalid_text');
      if (file.bytes.byteLength > 262144) throw new KnowledgeError('limit_exceeded');
      contentHash = createHash('sha256').update(file.bytes).digest('hex');
      chunks = this.ports.parser.parse(structuredClone(pending.document), structuredClone(file));
      validateChunks(pending.document, chunks);
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'unavailable') throw error;
      failure = error instanceof KnowledgeError && ['unsupported', 'invalid_text', 'empty_text', 'limit_exceeded'].includes(error.code) ? error.code as KnowledgeRecord['failure'] : 'parse_failed';
    }
    await authorize(this.ports.authorization, structuredClone(stableContext), { action: 'parse', scope: structuredClone(stableContext.scope), document: structuredClone(pending.document) });
    assertStableContext();
    const next: KnowledgeRecord = { indexJob: pending.indexJob, revision: pending.revision + 1, document: { ...pending.document, parsing: failure ? (failure === 'parse_failed' ? 'failed' : 'rejected') : 'parsed' },
      ...(contentHash ? { contentHash } : {}), ...(failure ? { failure } : {}) };
    const result = await this.ports.repository.commit({ scope: structuredClone(stableContext.scope), documentId: input.documentId, expectedRevision: pending.revision, operation: { id: `${input.operationId}:parse-result`, fingerprint: fingerprint(['parse-result', hash, failure ?? 'parsed', contentHash ?? null]), ...(failure ? { failure } : {}) }, next: structuredClone(next), ...(failure ? {} : { chunks: structuredClone(chunks) }), newVersion: false });
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
    const expectedHash = after.contentHash === undefined
      ? [fingerprint(['parse-result', hash, result.failure ?? 'parsed', null]),
        fingerprint(['parse-result', hash, result.failure ?? 'parsed'])]
      : [fingerprint(['parse-result', hash, result.failure ?? 'parsed', after.contentHash])];
    // Old parse receipts can still be observed, but an unbound historical
    // receipt never certifies bytes or makes legacy chunks newly retrievable.
    if (!expectedHash.includes(result.fingerprint)) throw new KnowledgeError('conflict');
    if (after.parseOperationId || after.revision !== input.expectedRevision + 2 || after.document.publication !== 'draft') throw new KnowledgeError('conflict');
    const expected = result.failure ? result.failure === 'parse_failed' ? 'failed' : 'rejected' : 'parsed';
    if (after.document.parsing !== expected || after.failure !== result.failure) throw new KnowledgeError('unavailable');
    return structuredClone(after);
  }
}
