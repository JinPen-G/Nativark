import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext, type AiMemoryDraft, type AiMemoryChangeDraft } from '@rental-os/shared';
import type { MemoryAction, MemoryConfirmation, StructuredMemoryPorts } from './knowledge.ports';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { actor, confirmationSchema, fingerprint, id, parse, preferenceSchema, sameScope, scopeSchema } from './knowledge-validation';

const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const timeSchema = z.string().datetime({ offset: true });
const base = { draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id, expectedRevision: revisionSchema };
const changeSchema: z.ZodType<AiMemoryChangeDraft> = z.discriminatedUnion('operation', [
  z.object({ ...base, operation: z.literal('modify'), preference: preferenceSchema }).strict(),
  z.object({ ...base, operation: z.literal('propose'), preference: preferenceSchema }).strict(),
  z.object({ ...base, operation: z.literal('confirm'), confirmationRecordId: id }).strict(),
  z.object({ ...base, operation: z.literal('delete') }).strict(),
]);
const proposalSchema = z.object({ memoryId: id, operationId: id, expiresAt: timeSchema, preference: preferenceSchema }).strict();

export class StructuredMemoryService {
  constructor(private readonly ports: StructuredMemoryPorts) {
    requiredPort(ports?.repository, ['read', 'operation', 'commit']);
    requiredPort(ports?.authorization, ['authorize']); requiredPort(ports?.confirmations, ['read']); requiredPort(ports?.clock, ['now']);
  }

  private async authorize(context: AiExecutionContext, action: MemoryAction, memory?: AiMemoryDraft) {
    try {
      parse(scopeSchema, context.scope);
      const owner = actor(context);
      if (memory && (!sameScope(memory.scope, context.scope) || fingerprint(memory.owner) !== fingerprint(owner))) unavailable();
      const contextHash = fingerprint(context), memoryHash = memory ? fingerprint(memory) : undefined;
      const stableContext = structuredClone(context);
      const request = structuredClone({ action, scope: context.scope, owner, memory });
      const requestHash = fingerprint(request);
      const answer = await this.ports.authorization.authorize(stableContext, request);
      if (fingerprint(context) !== contextHash || fingerprint(stableContext) !== contextHash || fingerprint(request) !== requestHash || (memory && fingerprint(memory) !== memoryHash)) unavailable();
      const grant = answer ? structuredClone(answer) : null;
      if (!grant || !sameScope(grant.scope, stableContext.scope) || fingerprint(grant.actor) !== fingerprint(owner) || grant.audience !== stableContext.audience || typeof grant.accessKey !== 'string' || !grant.accessKey || grant.accessKey.length > 256) unavailable();
      return grant;
    } catch { return unavailable(); }
  }

  private async load(context: AiExecutionContext, memoryId: string, action: MemoryAction): Promise<AiMemoryDraft> {
    await this.authorize(context, action);
    const memory = await this.ports.repository.read(context.scope, actor(context), parse(id, memoryId));
    if (!memory || memory.memoryId !== memoryId) unavailable();
    await this.authorize(context, action, memory);
    return memory;
  }

  private async confirmation(context: AiExecutionContext, memory: Exclude<AiMemoryDraft, { status: 'deleted' }>, recordId: string, revision: number): Promise<MemoryConfirmation> {
    try {
      if (context.actor.kind === 'automation') unavailable();
      const record = parse(confirmationSchema, await this.ports.confirmations.read(context, recordId));
      const now = this.ports.clock.now();
      if (record.id !== recordId || record.status !== 'confirmed' || record.memoryId !== memory.memoryId || record.revision !== revision || record.aclRevision !== memory.aclRevision || !sameScope(record.scope, memory.scope) || fingerprint(record.owner) !== fingerprint(memory.owner) || record.audience !== context.audience || fingerprint(record.preference) !== fingerprint(memory.preference) || record.memoryExpiresAt !== memory.expiresAt || Date.parse(record.issuedAt) > now || Date.parse(record.expiresAt) <= now || Date.parse(record.expiresAt) > Date.parse(memory.expiresAt) || Date.parse(memory.expiresAt) <= now) unavailable();
      return record;
    } catch { return unavailable(); }
  }

  async read(context: AiExecutionContext, memoryId: string): Promise<AiMemoryDraft> {
    const memory = await this.load(context, memoryId, 'read');
    if (memory.status !== 'deleted' && Date.parse(memory.expiresAt) <= this.ports.clock.now()) unavailable();
    if (memory.status === 'confirmed') await this.confirmation(context, memory, memory.confirmationRecordId, memory.revision - 1);
    const after = await this.load(context, memoryId, 'read');
    if (fingerprint(after) !== fingerprint(memory)) unavailable();
    // The final storage read may wait while the human confirmation is revoked.
    if (after.status === 'confirmed') await this.confirmation(context, after, after.confirmationRecordId, after.revision - 1);
    return structuredClone(after);
  }

  async propose(context: AiExecutionContext, value: unknown): Promise<AiMemoryDraft> {
    const input = parse(proposalSchema, value);
    const grant = await this.authorize(context, 'propose');
    if (context.actor.kind === 'automation') unavailable();
    const expiry = Date.parse(input.expiresAt), now = this.ports.clock.now();
    if (expiry <= now || expiry > now + 90 * 86400000) throw new KnowledgeError('invalid_input');
    const hash = fingerprint(['propose', input]);
    const existing = await this.ports.repository.read(context.scope, grant.actor, input.memoryId);
    if (existing) {
      await this.authorize(context, 'propose', existing);
      const receipt = await this.ports.repository.operation(context.scope, grant.actor, input.memoryId, input.operationId);
      if (!receipt || receipt.fingerprint !== hash) throw new KnowledgeError('conflict');
      return this.read(context, input.memoryId);
    }
    const next: AiMemoryDraft = { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, memoryId: input.memoryId, revision: 1, owner: grant.actor, scope: grant.scope, aclRevision: 1, expiresAt: input.expiresAt, status: 'proposed', preference: input.preference };
    await this.authorize(context, 'propose', next);
    const result = await this.ports.repository.commit({ scope: context.scope, owner: grant.actor, memoryId: input.memoryId, expectedRevision: 0, next, operation: { id: input.operationId, fingerprint: hash } });
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.read(context, input.memoryId);
  }

  async change(context: AiExecutionContext, operationId: string, value: unknown): Promise<AiMemoryDraft> {
    parse(id, operationId);
    const input = parse(changeSchema, value), before = await this.load(context, input.memoryId, input.operation);
    const hash = fingerprint(['change', input]);
    const receipt = await this.ports.repository.operation(context.scope, actor(context), input.memoryId, operationId);
    if (receipt) {
      if (receipt.fingerprint !== hash) throw new KnowledgeError('conflict');
      return this.read(context, input.memoryId);
    }
    if (before.revision !== input.expectedRevision || before.status === 'deleted') throw new KnowledgeError('conflict');
    if (input.operation !== 'delete' && Date.parse(before.expiresAt) <= this.ports.clock.now()) unavailable();
    const common = { draftVersion: before.draftVersion, memoryId: before.memoryId, revision: before.revision + 1, owner: before.owner, scope: before.scope, aclRevision: before.aclRevision, expiresAt: before.expiresAt };
    let next: AiMemoryDraft, confirmation: MemoryConfirmation | undefined;
    if (input.operation === 'delete') next = { ...common, status: 'deleted', deletedAt: new Date(this.ports.clock.now()).toISOString() };
    else if (input.operation === 'confirm') {
      if (before.status !== 'proposed') throw new KnowledgeError('conflict');
      confirmation = await this.confirmation(context, before, input.confirmationRecordId, before.revision);
      next = { ...common, status: 'confirmed', preference: before.preference, confirmationRecordId: input.confirmationRecordId };
    } else next = { ...common, status: 'proposed', preference: input.preference };
    await this.authorize(context, input.operation, before);
    const result = await this.ports.repository.commit({ scope: context.scope, owner: actor(context), memoryId: input.memoryId, expectedRevision: before.revision, next, operation: { id: operationId, fingerprint: hash }, ...(confirmation ? { confirmation } : {}) });
    if (result !== 'committed') throw new KnowledgeError('conflict');
    return this.read(context, input.memoryId);
  }
}
