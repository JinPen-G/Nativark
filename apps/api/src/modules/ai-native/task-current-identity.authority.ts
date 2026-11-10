import type { AuthService } from '../auth/auth.service';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { isAiStepExecutionContext } from './task-contract-validation';

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
      return structuredClone(candidate);
    } catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
  }
}
