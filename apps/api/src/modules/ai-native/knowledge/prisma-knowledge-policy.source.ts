import { isDeepStrictEqual } from 'node:util';
import { managedKnowledgePolicyCurrent, type KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import type { AiExecutionContext } from '@rental-os/shared';
import type { FormalActionPolicy, FormalKnowledgePolicySource, FormalMemoryPolicySource, FormalPolicyResource } from './formal-knowledge-authorization.adapter';
import { actor, fingerprint } from './knowledge-validation';
import type { KnowledgeAuthorizationRequest } from './knowledge.ports';
import { assertPreparedKnowledgeCreation, assertLifecycleConsumption } from './knowledge-policy-preparation-target';
import { lifecycleTargetSpec } from './knowledge-policy-management.validation';

export class PrismaKnowledgeActionPolicySource {
  readonly knowledge: FormalKnowledgePolicySource;
  readonly memory: FormalMemoryPolicySource;

  constructor(private readonly db: KnowledgePolicyReadDb,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.aiKnowledgeActionPolicy?.findUnique !== 'function'
      || typeof db?.aiKnowledgePolicyManagementOperation?.findFirst !== 'function') throw new Error('Knowledge policy storage unavailable');
    this.knowledge = { resolve: (context, request, resource) => this.read('knowledge', context, request.action, resource, request) };
    this.memory = { resolve: (context, request) => this.read('memory', context, request.action,
      request.memory ? { memoryId: request.memory.memoryId, revision: request.memory.revision,
        aclRevision: request.memory.aclRevision, owner: request.memory.owner } : { owner: request.owner }) };
  }

  private async read(domain: 'knowledge' | 'memory', input: AiExecutionContext,
    action: FormalActionPolicy['action'], inputResource?: FormalPolicyResource, request?: KnowledgeAuthorizationRequest): Promise<FormalActionPolicy | null> {
    const context = structuredClone(input), resource = structuredClone(inputResource ?? {});
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
      || !['operator', 'staff'].includes(context.audience)) return null;
    const principal = actor(context);
    const key = { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
      ...principal, audience: context.audience, domain, action, resourceKey: fingerprint(resource) };
    const row = structuredClone(await this.db.aiKnowledgeActionPolicy.findUnique({
      where: { tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey: key }
    }));
    if (!row || Object.entries(key).some(([name, value]) => (row as unknown as Record<string, unknown>)[name] !== value)
      || !row.enabled || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())
      || row.expiresAt.getTime() <= this.clock().getTime() || !isDeepStrictEqual(row.resource, resource)
      || !Array.isArray(row.requiredPermissions) || row.requiredPermissions.length < 1 || row.requiredPermissions.length > 64
      || row.requiredPermissions.some(p => typeof p !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$/u.test(p))
      || new Set(row.requiredPermissions).size !== row.requiredPermissions.length) return null;
    try {
      const managed = await managedKnowledgePolicyCurrent(this.db, row, this.clock());
      if (managed && request?.creation) await assertPreparedKnowledgeCreation(this.db, managed, request.creation, this.clock());
      if (managed && lifecycleTargetSpec.safeParse(managed.row.preparationTarget).success) {
        if (!request) return null;
        await assertLifecycleConsumption(this.db, managed, request, this.clock());
      }
    } catch { return null; }
    return { action, scope: structuredClone(context.scope), audience: context.audience, actor: principal,
      revision: row.revision, expiresAt: row.expiresAt.toISOString(), requiredPermissions: row.requiredPermissions as string[],
      resource, grantKey: fingerprint({ key, revision: row.revision, expiresAt: row.expiresAt.toISOString(), permissions: row.requiredPermissions }) };
  }
}
