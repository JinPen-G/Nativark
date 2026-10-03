import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeDocumentPorts, KnowledgeRecord, KnowledgeAction } from './knowledge.ports';
import { KnowledgeError, requiredPort } from './knowledge-errors';
import { assertRecord, authorize, draftInput, fingerprint, mutationInput, parse, validateChunks } from './knowledge-validation';

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
    await authorize(this.ports.authorization, context, { action, scope: context.scope });
    const record = await this.ports.repository.read(context.scope, documentId);
    assertRecord(record, context.scope, documentId);
    await authorize(this.ports.authorization, context, { action, scope: context.scope, document: record.document });
    return record;
  }

  async replay(context: AiExecutionContext, record: KnowledgeRecord, operationId: string, hash: string): Promise<boolean> {
    const receipt = await this.ports.repository.operation(context.scope, record.document.documentId, operationId);
    if (!receipt) return false;
    if (receipt.fingerprint !== hash) throw new KnowledgeError('conflict');
    return true;
  }

  async save(context: AiExecutionContext, action: KnowledgeAction, before: KnowledgeRecord, next: KnowledgeRecord, operationId: string, hash: string, newVersion = false): Promise<KnowledgeRecord> {
    await authorize(this.ports.authorization, context, { action, scope: context.scope, document: before.document });
    const result = await this.ports.repository.commit({ scope: context.scope, documentId: next.document.documentId, expectedRevision: before.revision, operation: { id: operationId, fingerprint: hash }, next, newVersion });
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.load(context, next.document.documentId, action);
  }

  async create(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(draftInput, value);
    const grant = await authorize(this.ports.authorization, context, { action: 'create', scope: context.scope, attachmentId: input.attachmentId });
    const hash = fingerprint(['create', input]);
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
    const before = await this.load(context, input.documentId, 'revise'), hash = fingerprint(['revise', expectedRevision, input]);
    if (await this.replay(context, before, input.operationId, hash)) return before;
    if (before.revision !== expectedRevision || before.document.publication === 'deleted' || before.document.documentVersion === input.documentVersion) throw new KnowledgeError('conflict');
    await authorize(this.ports.authorization, context, { action: 'revise', scope: context.scope, document: before.document, attachmentId: input.attachmentId });
    const { validUntil: oldExpiry, ...previous } = before.document;
    const next: KnowledgeRecord = { revision: before.revision + 1, document: { ...previous, documentVersion: input.documentVersion, attachmentId: input.attachmentId, title: input.title, validFrom: input.validFrom, ...(input.validUntil ? { validUntil: input.validUntil } : {}), publication: 'draft', parsing: 'pending', indexing: 'not_indexed' } };
    return this.save(context, 'revise', before, next, input.operationId, hash, true);
  }

  async parseDocument(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(mutationInput, value), before = await this.load(context, input.documentId, 'parse');
    const hash = fingerprint(['parse', input]);
    if (await this.replay(context, before, input.operationId, hash)) return before;
    if (before.revision !== input.expectedRevision || before.document.publication !== 'draft' || before.document.parsing === 'parsed' || before.parseOperationId) throw new KnowledgeError('conflict');
    const pending: KnowledgeRecord = { document: { ...before.document, parsing: 'pending', indexing: 'not_indexed' }, revision: before.revision + 1, parseOperationId: input.operationId };
    await this.save(context, 'parse', before, pending, input.operationId, hash);
    let chunks;
    let failure: KnowledgeRecord['failure'];
    try {
      await authorize(this.ports.authorization, context, { action: 'read_body', scope: context.scope, document: pending.document, attachmentId: pending.document.attachmentId });
      const file = await this.ports.files.read(context, pending.document, 262144);
      if (file.bytes.byteLength > 262144) throw new KnowledgeError('limit_exceeded');
      chunks = this.ports.parser.parse(pending.document, file);
      validateChunks(pending.document, chunks);
    } catch (error) {
      failure = error instanceof KnowledgeError && ['unsupported', 'invalid_text', 'empty_text', 'limit_exceeded'].includes(error.code) ? error.code as KnowledgeRecord['failure'] : 'parse_failed';
    }
    await authorize(this.ports.authorization, context, { action: 'parse', scope: context.scope, document: pending.document });
    const next: KnowledgeRecord = { revision: pending.revision + 1, document: { ...pending.document, parsing: failure ? (failure === 'parse_failed' ? 'failed' : 'rejected') : 'parsed' }, ...(failure ? { failure } : {}) };
    const result = await this.ports.repository.commit({ scope: context.scope, documentId: input.documentId, expectedRevision: pending.revision, operation: { id: `${input.operationId}:parse-result`, fingerprint: fingerprint(['parse-result', hash, failure ?? 'parsed']) }, next, ...(failure ? {} : { chunks }), newVersion: false });
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.load(context, input.documentId, 'parse');
  }
}
