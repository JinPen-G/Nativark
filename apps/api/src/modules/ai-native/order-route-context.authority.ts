import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { AiScopeResolutionError, type AiCurrentScopeAuthority } from './ai-scope.repository';
import { isAiStepExecutionContext } from './task-contract-validation';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const credentialSchema = z.object({ authorization: z.string().min(1).max(8192), requestId: id, audience: z.enum(['operator', 'staff']) }).strict();
export interface AiOrderRouteCredentialSource {
  /** Server-bound session source; not exposed in model/tool input. Read afresh on every resolution. */
  current(): Promise<z.infer<typeof credentialSchema>>;
}
const userSchema = z.object({ id, tenantId: id, isActive: z.literal(true), isSaasAdmin: z.boolean().optional(), permissions: z.array(z.string()) });

/** Identity projection after the EXISTING order-read Guard has run.
 * This does not read an order or authorize a write/AI feature; Core must still
 * verify the resource and projection when the eventual tool performs its read.
 * Each instance is bound to one server-selected order reference and credential source.
 */
export class AiOrderRouteContextAuthority implements AiCurrentScopeAuthority {
  private readonly orderId: string;
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource, orderId: string,
    private readonly clock: () => Date = () => new Date()) {
    if (!guard || typeof guard.canActivate !== 'function' || !credentials || typeof credentials.current !== 'function'
      || !id.safeParse(orderId).success || ['expire-pending', 'reconcile-pickup-overdue'].includes(orderId.toLowerCase())) throw new AiScopeResolutionError('AI_ACCESS_DENIED');
    this.orderId = orderId;
  }
  async resolve(): Promise<AiExecutionContext> {
    try {
      const credential = credentialSchema.parse(structuredClone(await this.credentials.current()));
      // A fresh ALS store prevents a prior request's role/scope from authorizing this read.
      return await runWithRequestIdentity({}, async () => {
        const staff = credential.audience === 'staff';
        const request: { url: string; originalUrl: string; method: string; headers: { authorization: string }; query: object; staffApiRequest: boolean; user?: unknown } = {
          url: `/api/rental/v1/orders/${this.orderId}`,
          originalUrl: staff ? `/api/staff/v1/orders/${this.orderId}` : `/api/rental/v1/orders/${this.orderId}`,
          method: 'GET', headers: { authorization: credential.authorization }, query: {}, staffApiRequest: staff
        };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw Error();
        const user = userSchema.parse(request.user), identity = getRequestIdentity();
        if (!identity || identity.isSaasAdmin || user.isSaasAdmin || identity.userId !== user.id || identity.tenantId !== user.tenantId
          || identity.staffApi !== staff || !identity.workspaceId) throw Error();
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw Error();
        const candidate = {
          contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: credential.audience, actor: { kind: 'user', userId: user.id },
          scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId },
          access: { permissions: user.permissions, dataScope: identity.dataScope, locationScope: identity.locationScope,
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) }
        };
        if (!isAiStepExecutionContext(candidate)) throw Error();
        return structuredClone(candidate);
      });
    } catch { throw new AiScopeResolutionError('AI_ACCESS_DENIED'); }
  }
}
