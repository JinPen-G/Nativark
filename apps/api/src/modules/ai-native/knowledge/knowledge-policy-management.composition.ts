import { z } from 'zod';
import type { AiKnowledgePolicyChangeDraft, AiKnowledgePolicyHttpLifecycleDraft, AiKnowledgePolicyHttpResultDraft,
  AiKnowledgePolicySnapshotDraft } from '../../../../../../packages/shared/src/ai-knowledge-policy-management-draft';
import { HumanKnowledgePolicyManagementService, type KnowledgePolicyManagementDb, type KnowledgePolicyManagementDependencies } from './human-knowledge-policy-management.service';
import { KnowledgePolicyManagementError, managementParse, policySnapshot } from './knowledge-policy-management.validation';

export const KNOWLEDGE_POLICY_MANAGEMENT = Symbol('KNOWLEDGE_POLICY_MANAGEMENT');
export type KnowledgePolicyManagementFactoryOptions = { enabled: boolean; guard: KnowledgePolicyManagementDependencies['guard'] };
const requestSchema = z.object({ authorization: z.string().min(1).max(8192), requestId: z.string().min(1).max(191), audience: z.literal('operator') }).strict();
type GovernanceResult = Awaited<ReturnType<HumanKnowledgePolicyManagementService['prepare']>>;

function publicSnapshot(value: AiKnowledgePolicySnapshotDraft): AiKnowledgePolicySnapshotDraft {
  return { revision: value.revision, enabled: value.enabled, requiredPermissions: [...value.requiredPermissions], expiresAt: value.expiresAt };
}
function publicChange(value: AiKnowledgePolicyChangeDraft): AiKnowledgePolicyChangeDraft {
  return { version: value.version, authorityId: value.authorityId, operationKey: value.operationKey,
    expectedRevision: value.expectedRevision, action: value.action, requiredPermissions: [...value.requiredPermissions], expiresAt: value.expiresAt };
}
function publicLifecycle(value: Awaited<ReturnType<HumanKnowledgePolicyManagementService['reviewLifecycleTarget']>>): AiKnowledgePolicyHttpLifecycleDraft {
  const semantics = 'target_review_not_execution_permission' as const;
  if (value.state !== 'current') return { state: value.state, semantics };
  const target = value.target, head = target.from;
  const from = { documentId: head.documentId, revision: head.revision, documentVersion: head.documentVersion,
    attachmentId: head.attachmentId, aclRevision: head.aclRevision };
  if (target.action === 'delete') return { state: 'current', semantics, target: {
    version: target.version, action: 'delete', operationId: target.operationId, receiptOperationId: target.operationId,
    from, expiresAt: target.expiresAt,
  } };
  return { state: 'current', semantics, target: {
    version: target.version, action: 'revise', operationId: target.operationId, from,
    to: { documentVersion: target.to.documentVersion, attachmentId: target.to.attachmentId, uploadSessionId: target.to.uploadSessionId,
      title: target.to.title, validFrom: target.to.validFrom, ...(target.to.validUntil ? { validUntil: target.to.validUntil } : {}) },
    expiresAt: target.expiresAt,
  } };
}
async function publicResult(result: GovernanceResult, service: HumanKnowledgePolicyManagementService): Promise<AiKnowledgePolicyHttpResultDraft> {
  if (result.state === 'unknown' || result.state === 'not_observed') return {
    state: result.state, operationKey: result.operationKey, ...(result.changeHash ? { changeHash: result.changeHash } : {}),
    retryable: false, nextAction: result.nextAction, executionPermission: false,
  };
  const lifecycle = result.state === 'expired' || result.state === 'stale'
    ? publicLifecycle({ state: 'unavailable' })
    : publicLifecycle(await service.reviewLifecycleTarget({ operationKey: result.operationKey, changeHash: result.changeHash }));
  if (result.state === 'observed') return {
    state: 'observed', operationKey: result.operationKey, preparationId: result.preparationId, changeHash: result.changeHash,
    policyKeyHash: result.policyKeyHash, result: publicSnapshot(result.result), recordedAt: result.recordedAt,
    retryable: false, executionPermission: false, lifecycle,
  };
  if (!('proposal' in result)) throw new KnowledgePolicyManagementError('unavailable');
  return { state: result.state, preparationId: result.preparationId, operationKey: result.operationKey,
    changeHash: result.changeHash, policyKeyHash: result.policyKeyHash,
    before: result.before === null ? null : publicSnapshot(managementParse(policySnapshot, result.before)),
    proposal: publicChange(result.proposal), expiresAt: result.expiresAt, executionPermission: false, lifecycle };
}

export function createKnowledgePolicyManagementFactory(input: KnowledgePolicyManagementFactoryOptions & {
  db: KnowledgePolicyManagementDb; auth: KnowledgePolicyManagementDependencies['auth']; clock: () => Date;
}) {
  const open = (request: unknown) => {
    if (input.enabled !== true) throw new KnowledgePolicyManagementError('unavailable');
    let credential: z.infer<typeof requestSchema> | undefined = structuredClone(managementParse(requestSchema, request));
    const service = new HumanKnowledgePolicyManagementService(input.db, { auth: input.auth, guard: input.guard,
      credentials: { current: async () => {
        if (!credential) throw new KnowledgePolicyManagementError('unavailable');
        return structuredClone(credential);
      } } }, input.clock);
    return { service, close() { credential = undefined; } };
  };
  const invoke = <T>(request: unknown, action: (service: HumanKnowledgePolicyManagementService) => Promise<T>) => {
    const scoped = open(request);
    return (async () => {
      try { return await action(scoped.service); }
      finally { scoped.close(); }
    })();
  };
  return {
    prepareTarget: (request: unknown, value: unknown) => invoke(request, service => service.prepareTarget(structuredClone(value))),
    target: (request: unknown, value: unknown) => invoke(request, service => service.target(structuredClone(value))),
    bindTarget: (request: unknown, value: unknown) => invoke(request, service => service.bindTarget(structuredClone(value))),
    read: (request: unknown, value: unknown) => invoke(request, service => service.read(structuredClone(value))),
    prepare: (request: unknown, value: unknown) => invoke(request, async service => publicResult(await service.prepare(structuredClone(value)), service)),
    preparation: (request: unknown, value: unknown) => invoke(request, async service => publicResult(await service.preparation(structuredClone(value)), service)),
    commit: (request: unknown, value: unknown) => invoke(request, async service => publicResult(await service.commit(structuredClone(value)), service)),
    operation: (request: unknown, value: unknown) => invoke(request, async service => publicResult(await service.operation(structuredClone(value)), service)),
  };
}
export type KnowledgePolicyManagementApplication = ReturnType<typeof createKnowledgePolicyManagementFactory>;
