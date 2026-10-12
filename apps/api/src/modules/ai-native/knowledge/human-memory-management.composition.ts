import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiMemoryDraft } from '@rental-os/shared';
import type { AiMemoryManagementResponsesDraft } from '../../../../../../packages/shared/src/ai-memory-management-http-draft';
import type { AuthService } from '../../auth/auth.service';
import type { KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import type { MemoryPrismaClient } from './prisma-memory.repository';
import type { KnowledgeClock } from './knowledge.ports';
import { PrismaKnowledgeActionPolicySource } from './prisma-knowledge-policy.source';
import { FormalMemoryAuthorizationAdapter } from './formal-knowledge-authorization.adapter';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';
import { id, parse, preferenceSchema, memoryDraftSchema } from './knowledge-validation';
import { requiredPort, unavailable } from './knowledge-errors';

export type HumanMemoryManagementDependencies = { db: MemoryPrismaClient & KnowledgePolicyReadDb;
  auth: Pick<AuthService, 'resolveAccessContext'>; clock: KnowledgeClock };
export type HumanMemoryManagementRequest = { [K in keyof AiMemoryManagementResponsesDraft]:
  (value: unknown) => Promise<AiMemoryManagementResponsesDraft[K]> } & { close(): void };
const confirmationInput = z.object({ memoryId: id, expectedRevision: z.number().int().min(1).max(4294967293),
  operationId: id.max(110), expiresAt: z.string().datetime({ offset: true }) }).strict();
const changeInput = z.object({ confirmation: z.literal('change_memory_preference'), operationId: id.max(110),
  command: z.discriminatedUnion('operation', [
    z.object({ draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id,
      expectedRevision: z.number().int().min(1).max(4294967293), operation: z.literal('modify'), preference: preferenceSchema }).strict(),
    z.object({ draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id,
      expectedRevision: z.number().int().min(1).max(4294967293), operation: z.literal('delete') }).strict(),
  ]) }).strict();

/** One current human request; no file platform, model, task, approval or worker
 * dependency. All actions use the original persisted memory policy/consent. */
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
    const requestId = randomUUID(), { db, auth, clock } = this.dependencies;
    const credentials = { current: async () => {
      if (authorization === undefined) return unavailable();
      return { authorization, requestId, audience: 'operator' as const };
    } };
    const source = new PrismaKnowledgeActionPolicySource(db, () => new Date(clock.now()));
    const memory = new PersistentMemoryConsentService({ db, auth, clock, credentials,
      authorization: new FormalMemoryAuthorizationAdapter(auth, credentials, source.memory, () => new Date(clock.now())) });
    const mutation = (value: AiMemoryDraft) => ({ memory: parse(memoryDraftSchema, value),
      semantics: 'human_preference_not_business_approval' as const });
    return {
      list: value => memory.list(value),
      state: async value => memory.state(parse(z.object({ memoryId: id }).strict(), value).memoryId),
      read: async value => mutation(await memory.read(parse(z.object({ memoryId: id }).strict(), value).memoryId)),
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
