import type { AuthService } from './rental-adapters/auth.service';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { isAiStepExecutionContext } from './task-contract-validation';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

/** Current workspace identity and shared business-location projection only;
 * this grants neither task/resource access nor permission to execute. */
export class AiTaskCurrentIdentityAuthority {
  constructor(private readonly auth: Pick<AuthService, 'resolveAccessContext'>,
    private readonly credentials: AiTaskCredentialSource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof auth?.resolveAccessContext !== 'function' || typeof credentials?.current !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }

  async resolve(): Promise<AiExecutionContext> {
    try {
      const credential = structuredClone(await this.credentials.current());
      if (!credential || !['operator', 'staff'].includes(credential.audience) || typeof credential.authorization !== 'string'
        || credential.authorization.length < 1 || credential.authorization.length > 8192 || typeof credential.requestId !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const access = structuredClone(await this.auth.resolveAccessContext(credential.authorization, { audience: credential.audience, businessScope: true }));
      // A slow Auth response cannot revive request-local credentials closed by
      // timeout/abort, or continue under a token/audience changed during await.
      // requestId is correlation only and is not an authorization comparison.
      const current = structuredClone(await this.credentials.current());
      if (current.authorization !== credential.authorization || current.audience !== credential.audience) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      const now = this.clock();
      if (!access?.user.isActive || access.user.isSaasAdmin || !access.workspaceValid || !access.workspaceId
        || access.user.id !== access.tenantUser.id || access.user.tenantId !== access.tenantUser.tenantId
        || !Array.isArray(access.user.permissions) || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // An organization allowlist must come from current Auth's shared business
      // projection, never the raw member configuration or a prior HTTP ALS store.
      if (access.user.dataScope === 'organization' && (!access.user.organizationId
        || access.businessLocationScope?.mode !== 'selected')) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const candidate = {
        contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(), audience: credential.audience,
        actor: { kind: 'user', userId: access.user.id }, scope: { kind: 'workspace', tenantId: access.user.tenantId, workspaceId: access.workspaceId },
        access: { permissions: [...access.user.permissions], dataScope: access.user.dataScope,
          locationScope: structuredClone(access.businessLocationScope ?? access.user.locationScope),
          ...(access.user.organizationId ? { organizationId: access.user.organizationId } : {}) }
      };
      if (!isAiStepExecutionContext(candidate)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (hasRentalBusinessTenantFence()) {
        // A selected host already owns the original Guard identity. A fresh Auth
        // read may verify it, but cannot replace it or revive a cleared ALS store.
        const selected = getRequestIdentity(), scope = access.businessLocationScope ?? access.user.locationScope;
        const session = selected?.accessSession;
        const locationKey = (value: typeof scope) => value && requestFingerprint({ mode: value.mode, locationIds: [...value.locationIds].sort() });
        if (!selected || selected.tenantId !== access.user.tenantId || selected.workspaceId !== access.workspaceId
          || selected.userId !== access.user.id || selected.audience !== credential.audience || selected.isSaasAdmin !== false
          || Boolean(selected.staffApi) !== (credential.audience === 'staff') || access.user.mustChangePassword
          || !session || session.sessionId !== access.accessSession.sessionId || session.expiresAt !== access.accessSession.expiresAt
          || Boolean(selected.isPlatformAdmin) !== Boolean(access.user.isPlatformAdmin) || selected.dataScope !== access.user.dataScope
          || selected.organizationId !== access.user.organizationId || locationKey(selected.locationScope) !== locationKey(scope)
          || requestFingerprint([...(selected.permissions ?? [])].sort()) !== requestFingerprint([...access.user.permissions].sort()))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      return structuredClone(candidate);
    } catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
  }
}
