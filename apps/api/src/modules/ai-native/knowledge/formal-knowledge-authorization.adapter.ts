import type { AuthService } from '../../auth/auth.service';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import type { AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeAction, KnowledgeAuthorizationPort, KnowledgeAuthorizationRequest, KnowledgeGrant, MemoryAction, MemoryAuthorizationPort, KnowledgeUploadRevision } from './knowledge.ports';
import { actor, fingerprint, sameScope } from './knowledge-validation';

export type FormalPolicyResource = {
  documentId?: string; documentVersion?: string; attachmentId?: string; aclRevision?: number;
  memoryId?: string; revision?: number; owner?: { actorKind: string; actorId: string };
  upload?: { documentId: string; idempotencyKey: string; fileName: string; mimeType: string; sizeBytes: number; revision?: KnowledgeUploadRevision };
};

export type FormalActionPolicy = {
  action: KnowledgeAction | MemoryAction;
  scope: AiExecutionContext['scope'];
  audience: AiExecutionContext['audience'];
  actor: { actorKind: string; actorId: string };
  revision: number;
  expiresAt: string;
  requiredPermissions: readonly string[];
  grantKey: string;
  resource?: FormalPolicyResource;
};

export interface FormalKnowledgePolicySource {
  resolve(context: AiExecutionContext, request: KnowledgeAuthorizationRequest, resource?: FormalPolicyResource): Promise<FormalActionPolicy | null>;
}

export interface FormalMemoryPolicySource {
  resolve(context: AiExecutionContext, request: Parameters<MemoryAuthorizationPort['authorize']>[1]): Promise<FormalActionPolicy | null>;
}

const validPermission = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$/u.test(value);
const validKey = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/u.test(value);

/**
 * Auth-backed policy adapter. Auth resolves the current actor/scope; the
 * policy source is a separate server-owned, versioned action policy. Neither
 * caller-provided scope nor membership alone grants a knowledge action.
 */
export class FormalKnowledgeAuthorizationAdapter implements KnowledgeAuthorizationPort {
  private readonly identities: AiTaskCurrentIdentityAuthority;
  constructor(auth: Pick<AuthService, 'resolveAccessContext'>, credentials: AiTaskCredentialSource,
    private readonly policies: FormalKnowledgePolicySource, private readonly clock: () => Date = () => new Date()) {
    this.identities = new AiTaskCurrentIdentityAuthority(auth, credentials, this.clock);
  }

  private async evaluate(context: AiExecutionContext, action: KnowledgeAction | MemoryAction,
    requestScope: AiExecutionContext['scope'], resource?: FormalPolicyResource, creation?: KnowledgeAuthorizationRequest['creation']): Promise<KnowledgeGrant | null> {
    try {
      const current = await this.identities.resolve();
      if (fingerprint(current) !== fingerprint(context) || !sameScope(current.scope, requestScope)
        || current.actor.kind === 'automation' || current.actor.kind === 'customer' && action !== 'read') return null;
      const policyRequest = { action, scope: structuredClone(requestScope), ...(creation ? { creation: structuredClone(creation) } : {}) } as KnowledgeAuthorizationRequest;
      const policy = structuredClone(await this.policies.resolve(structuredClone(current), policyRequest, resource));
      if (!policy || policy.action !== action || !sameScope(policy.scope, current.scope) || policy.audience !== current.audience
        || fingerprint(policy.actor) !== fingerprint(actor(current)) || !Number.isSafeInteger(policy.revision) || policy.revision < 1
        || !Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) <= this.clock().getTime()
        || !validKey(policy.grantKey) || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length < 1
        || policy.requiredPermissions.length > 64 || policy.requiredPermissions.some(permission => !validPermission(permission))
        || new Set(policy.requiredPermissions).size !== policy.requiredPermissions.length) return null;
      if (!('access' in current) || policy.requiredPermissions.some(permission => !current.access.permissions.includes(permission))) return null;
      if (resource && fingerprint(policy.resource) !== fingerprint(resource)) return null;
      const before = fingerprint(current);
      const rechecked = structuredClone(await this.identities.resolve());
      const latest = structuredClone(await this.policies.resolve(rechecked, policyRequest, resource));
      if (before !== fingerprint(rechecked) || fingerprint(latest) !== fingerprint(policy) || Date.parse(policy.expiresAt) <= this.clock().getTime()) return null;
      return { scope: structuredClone(current.scope), actor: structuredClone(actor(current)) as never, audience: current.audience, accessKey: policy.grantKey };
    } catch { return null; }
  }

  authorize(context: AiExecutionContext, request: KnowledgeAuthorizationRequest) {
    if ((request.action === 'upload') !== Boolean(request.upload) || request.upload && (request.document || request.attachmentId)) return Promise.resolve(null);
    const resource = request.upload ? { upload: structuredClone(request.upload) } : request.document ? { documentId: request.document.documentId, documentVersion: request.document.documentVersion,
      attachmentId: request.attachmentId ?? request.document.attachmentId, aclRevision: request.document.aclRevision } : request.attachmentId ? { attachmentId: request.attachmentId } : undefined;
    if (request.creation && request.action !== 'create') return Promise.resolve(null);
    return this.evaluate(context, request.action, request.scope, resource, request.creation);
  }
}

/** Memory uses the same current identity and action-policy rules but keeps its
 * action vocabulary and resource binding separate from document ACL policy. */
export class FormalMemoryAuthorizationAdapter implements MemoryAuthorizationPort {
  private readonly identities: AiTaskCurrentIdentityAuthority;
  constructor(auth: Pick<AuthService, 'resolveAccessContext'>, credentials: AiTaskCredentialSource,
    private readonly policies: FormalMemoryPolicySource, private readonly clock: () => Date = () => new Date()) {
    this.identities = new AiTaskCurrentIdentityAuthority(auth, credentials, this.clock);
  }
  async authorize(context: AiExecutionContext, request: Parameters<MemoryAuthorizationPort['authorize']>[1]) {
    try {
      const current = await this.identities.resolve();
      if (fingerprint(current) !== fingerprint(context) || !sameScope(current.scope, request.scope)
        || fingerprint(actor(current)) !== fingerprint(request.owner) || current.actor.kind !== 'user') return null;
      const resource = request.memory ? { memoryId: request.memory.memoryId, revision: request.memory.revision,
        aclRevision: request.memory.aclRevision, owner: request.memory.owner } : undefined;
      const policy = structuredClone(await this.policies.resolve(structuredClone(current), request));
      if (!policy || policy.action !== request.action || !sameScope(policy.scope, current.scope)
        || policy.audience !== current.audience || fingerprint(policy.actor) !== fingerprint(actor(current))
        || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !Number.isFinite(Date.parse(policy.expiresAt))
        || Date.parse(policy.expiresAt) <= this.clock().getTime() || !validKey(policy.grantKey)
        || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length < 1
        || policy.requiredPermissions.some(permission => !validPermission(permission))
        || !('access' in current) || policy.requiredPermissions.some(permission => !current.access.permissions.includes(permission))) return null;
      if (resource && fingerprint(policy.resource) !== fingerprint(resource)) return null;
      const latestContext = await this.identities.resolve(), latest = structuredClone(await this.policies.resolve(latestContext, request));
      if (fingerprint(latestContext) !== fingerprint(current) || fingerprint(latest) !== fingerprint(policy)
        || Date.parse(policy.expiresAt) <= this.clock().getTime()) return null;
      return { scope: structuredClone(current.scope), actor: structuredClone(actor(current)) as never, audience: current.audience, accessKey: policy.grantKey };
    } catch { return null; }
  }
}
