/** Sensitive read delivery through the original OperationLogService. Audit
 * stores only source IDs/revisions/hashes under the current authorized scope;
 * it grants no access and cannot record plaintext, consent values or tokens.
 * A durable audit is followed by reauthorization of the same observed data. */
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { OperationLogService } from '../../../common/operation-log.service';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { KnowledgeError, unavailable } from './knowledge-errors';

export type KnowledgeReadOperationLogs = Pick<OperationLogService, 'record'>;
const actions = {
  document: 'ai.knowledge.document.read', source: 'ai.knowledge.source.read',
  memory: 'ai.memory.read', preferences: 'ai.memory.preferences.read',
  collect: 'ai.knowledge.input.collect', revalidateInput: 'ai.knowledge.input.revalidate',
  selectPreferences: 'ai.memory.preferences.select', revalidatePreferences: 'ai.memory.preferences.revalidate',
  confirmation: 'ai.memory.confirmation.read',
} as const;
type Operation = keyof typeof actions;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const referenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document'), documentId: id, documentVersion: id, aclRevision: revision,
    revision: revision.optional(), chunkId: id.optional(), contentHash: hash }).strict(),
  z.object({ kind: z.literal('memory'), memoryId: id, revision, aclRevision: revision,
    confirmationRecordId: id.optional(), contentHash: hash }).strict(),
  z.object({ kind: z.literal('confirmation'), memoryId: id, confirmationRecordId: id,
    revision, aclRevision: revision, contentHash: hash }).strict(),
]);
export type KnowledgeReadAuditReference = z.infer<typeof referenceSchema>;

export const knowledgeReadHash = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > 262144) return unavailable();
  return requestFingerprint(value);
};

export class KnowledgeSensitiveReadAudit {
  constructor(private readonly logs: KnowledgeReadOperationLogs | undefined,
    private readonly check: (context: AiExecutionContext) => Promise<void>) {}

  async read<T>(context: AiExecutionContext, operation: Operation, input: {
    read(): Promise<T>; revalidate(observed: T): Promise<T>;
    references(observed: T): readonly KnowledgeReadAuditReference[];
    comparable(observed: T): unknown;
  }): Promise<T> {
    if (typeof this.logs?.record !== 'function') return unavailable();
    const stable = structuredClone(context), scope = stable.scope;
    if (stable.actor.kind !== 'user' || scope.kind !== 'workspace' || stable.audience !== 'operator'
      || !('access' in stable) || !id.safeParse(stable.actor.userId).success
      || !id.safeParse(scope.tenantId).success || !id.safeParse(scope.workspaceId).success
      || !id.safeParse(stable.requestId).success || !Object.hasOwn(actions, operation)) return unavailable();
    const contextHash = knowledgeReadHash(stable);
    const current = async () => {
      if (knowledgeReadHash(context) !== contextHash || knowledgeReadHash(stable) !== contextHash) return unavailable();
      await this.check(stable);
    };
    await current();
    const observed = structuredClone(await input.read());
    await current();
    const observedHash = knowledgeReadHash(input.comparable(observed));
    let references: KnowledgeReadAuditReference[];
    try { references = z.array(referenceSchema).max(32).parse(structuredClone(input.references(observed))); }
    catch { return unavailable(); }
    const referenceHash = knowledgeReadHash(references);
    try {
      // The original logger derives workspace from ALS. Bind only the current
      // server-resolved context here and restore the caller's ALS afterwards.
      await runWithRequestIdentity({ tenantId: scope.tenantId, workspaceId: scope.workspaceId,
        userId: stable.actor.userId, audience: stable.audience, isSaasAdmin: false,
        dataScope: stable.access.dataScope, locationScope: structuredClone(stable.access.locationScope),
        ...('organizationId' in stable.access ? { organizationId: stable.access.organizationId } : {}) },
      () => this.logs!.record({ tenantId: scope.tenantId, userId: stable.actor.userId,
        action: actions[operation], targetType: 'ai-sensitive-read', targetId: stable.requestId,
        metadata: { version: 'ain-knowledge-sensitive-read-1', scope: structuredClone(scope), references,
          contentHash: observedHash, authorityHash: knowledgeReadHash({ actor: stable.actor,
            audience: stable.audience, scope, access: stable.access }),
          delivery: 'pending_final_source_recheck' }, requireSuccess: true }));
    } catch { return unavailable(); }
    await current();
    const verified = structuredClone(await input.revalidate(structuredClone(observed)));
    await current();
    if (knowledgeReadHash(input.comparable(verified)) !== observedHash
      || knowledgeReadHash(input.references(verified)) !== referenceHash) throw new KnowledgeError('conflict');
    return observed;
  }
}
