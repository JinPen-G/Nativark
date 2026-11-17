import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiMemoryDraft } from '@rental-os/shared';
import type { AiMemoryManagementResponsesDraft } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import type { MemoryPrismaClient } from './prisma-memory.repository';
import type { KnowledgeClock } from './knowledge.ports';
import { PrismaKnowledgeActionPolicySource } from './prisma-knowledge-policy.source';
import { FormalMemoryAuthorizationAdapter } from './formal-knowledge-authorization.adapter';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';
import { id, parse, preferenceSchema, memoryDraftSchema } from './knowledge-validation';
import { requiredPort, unavailable } from './knowledge-errors';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { KnowledgeSensitiveReadAudit, knowledgeReadHash, type KnowledgeReadAuditReference,
  type KnowledgeReadOperationLogs } from './knowledge-sensitive-read.audit';

export type HumanMemoryManagementDependencies = { db: MemoryPrismaClient & KnowledgePolicyReadDb;
  auth: Pick<AuthService, 'resolveAccessContext'>; clock: KnowledgeClock;
  /** Original durable logger; missing dependency refuses sensitive read delivery. */
  operationLogs?: KnowledgeReadOperationLogs };
export type HumanMemoryManagementRequest = { [K in keyof AiMemoryManagementResponsesDraft]:
  (value: unknown) => Promise<AiMemoryManagementResponsesDraft[K]> } & {
    /** Server consumers only; these do not register new public routes. */
    selectPreferences(value: unknown): ReturnType<PersistentMemoryConsentService['selectPreferences']>;
    revalidatePreferences(value: unknown): ReturnType<PersistentMemoryConsentService['revalidateSelection']>;
    confirmationDetail(value: unknown): ReturnType<PersistentMemoryConsentService['confirmationDetail']>;
    close(): void;
  };
const confirmationInput = z.object({ memoryId: id, expectedRevision: z.number().int().min(1).max(4294967293),
  operationId: id.max(110), expiresAt: z.string().datetime({ offset: true }) }).strict();
const changeInput = z.object({ confirmation: z.literal('change_memory_preference'), operationId: id.max(110),
  command: z.discriminatedUnion('operation', [
    z.object({ draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id,
      expectedRevision: z.number().int().min(1).max(4294967293), operation: z.literal('modify'), preference: preferenceSchema }).strict(),
    z.object({ draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id,
      expectedRevision: z.number().int().min(1).max(4294967293), operation: z.literal('delete') }).strict(),
  ]) }).strict();

/** One current human request using original memory policy/consent. Sensitive
 * reads await durable reference-only audit and recheck the same source. This
 * does not grant a model, business approval, worker or additional write action. */
export class HumanMemoryManagementRequestFactory {
  constructor(private readonly dependencies: HumanMemoryManagementDependencies) {
    requiredPort(dependencies?.auth, ['resolveAccessContext']); requiredPort(dependencies?.clock, ['now']);
    requiredPort(dependencies?.db, ['$transaction']); requiredPort(dependencies?.db?.aiKnowledgeActionPolicy, ['findUnique']);
    requiredPort(dependencies?.db?.aiKnowledgePolicyManagementOperation, ['findFirst']);
    if ('credentials' in dependencies) return unavailable();
  }
  open(request: { headers: { authorization?: unknown } }): HumanMemoryManagementRequest {
    const header = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
    if (!header.success) return unavailable();
    let authorization: string | undefined = header.data;
    const requestId = randomUUID(), { db, auth, clock, operationLogs } = this.dependencies;
    const credentials = { current: async () => {
      if (authorization === undefined) return unavailable();
      return { authorization, requestId, audience: 'operator' as const };
    } };
    const requestAuth: typeof auth = { resolveAccessContext: async (...args) => {
      await credentials.current();
      const current = await auth.resolveAccessContext(...args);
      await credentials.current();
      return current;
    } };
    const source = new PrismaKnowledgeActionPolicySource(db, () => new Date(clock.now()));
    const memory = new PersistentMemoryConsentService({ db, auth: requestAuth, clock, credentials,
      authorization: new FormalMemoryAuthorizationAdapter(requestAuth, credentials, source.memory, () => new Date(clock.now())) });
    const session = new KnowledgeCurrentSession(requestAuth, credentials, clock);
    const audit = new KnowledgeSensitiveReadAudit(operationLogs, context => session.check(context));
    const mutation = (value: AiMemoryDraft) => ({ memory: parse(memoryDraftSchema, value),
      semantics: 'human_preference_not_business_approval' as const });
    const preferenceReference = (item: Awaited<ReturnType<PersistentMemoryConsentService['selectPreferences']>>['items'][number]): KnowledgeReadAuditReference => ({
      kind: 'memory', memoryId: item.memoryId, revision: item.revision, aclRevision: item.aclRevision,
      confirmationRecordId: item.confirmationRecordId, contentHash: knowledgeReadHash(item.preference),
    });
    return {
      selectPreferences: value => {
        const command = structuredClone(value);
        return session.run(context => audit.read(context, 'selectPreferences', {
          read: () => memory.selectPreferences(command), revalidate: observed => memory.revalidateSelection(observed),
          comparable: observed => observed, references: observed => observed.items.map(preferenceReference),
        }));
      },
      revalidatePreferences: value => {
        const command = structuredClone(value);
        return session.run(context => audit.read(context, 'revalidatePreferences', {
          read: () => memory.revalidateSelection(command), revalidate: observed => memory.revalidateSelection(observed),
          comparable: observed => observed, references: observed => observed.items.map(preferenceReference),
        }));
      },
      confirmationDetail: value => {
        const command = parse(z.object({ memoryId: id }).strict(), value);
        return session.run(context => audit.read(context, 'confirmation', {
          read: () => memory.confirmationDetail(command.memoryId), revalidate: () => memory.confirmationDetail(command.memoryId),
          comparable: observed => observed, references: observed => [{ kind: 'confirmation', memoryId: observed.memoryId,
            confirmationRecordId: observed.confirmationRecordId, revision: observed.revision,
            aclRevision: observed.aclRevision, contentHash: knowledgeReadHash(observed.preference) }],
        }));
      },
      list: value => memory.list(value),
      state: async value => memory.state(parse(z.object({ memoryId: id }).strict(), value).memoryId),
      read: value => {
        const command = parse(z.object({ memoryId: id }).strict(), value);
        return session.run(context => audit.read(context, 'memory', {
          read: async () => mutation(await memory.read(command.memoryId)),
          revalidate: async () => mutation(await memory.read(command.memoryId)), comparable: observed => observed,
          references: observed => [{ kind: 'memory', memoryId: observed.memory.memoryId, revision: observed.memory.revision,
            aclRevision: observed.memory.aclRevision,
            ...(observed.memory.status === 'confirmed' ? { confirmationRecordId: observed.memory.confirmationRecordId } : {}),
            contentHash: knowledgeReadHash(observed.memory.status === 'deleted' ? observed.memory : observed.memory.preference) }],
        }));
      },
      propose: async value => {
        const input = parse(z.object({ confirmation: z.literal('propose_memory_preference'), command: z.object({ memoryId: id,
          operationId: id.max(110), expiresAt: z.string().datetime({ offset: true }), preference: preferenceSchema }).strict() }).strict(), value);
        return mutation(await memory.propose(input.command));
      },
      confirm: async value => {
        const input = parse(z.object({ confirmation: z.literal('confirm_memory_preference'), command: confirmationInput }).strict(), value);
        return mutation(await memory.confirm(input.command));
      },
      resumeConfirmation: async value => mutation(await memory.resumeConfirmation(parse(confirmationInput, value))),
      confirmation: async value => memory.confirmationStatus(parse(confirmationInput, value)),
      change: async value => { const input = parse(changeInput, value); return mutation(await memory.change(input.operationId, input.command)); },
      changeStatus: async value => {
        const input = parse(changeInput.omit({ confirmation: true }), value);
        return memory.changeStatus(input.operationId, input.command);
      },
      revoke: async value => {
        const input = parse(z.object({ confirmation: z.literal('revoke_memory_consent'), command: z.object({ memoryId: id,
          expectedRevision: z.number().int().min(2).max(4294967294) }).strict() }).strict(), value);
        const proof = await memory.revoke(input.command);
        return { memoryId: proof.memoryId, confirmationRecordId: proof.id, status: 'revoked' as const,
          semantics: 'consent_revoked_not_memory_deleted' as const };
      },
      operation: value => memory.operationRecovery(value),
      close() { authorization = undefined; },
    };
  }
}
