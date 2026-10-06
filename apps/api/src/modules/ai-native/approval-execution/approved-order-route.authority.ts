import { ValidationPipe } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { Prisma } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext, type CreateRentalOrderRequest } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import { CreateRentalOrderDto } from '../../rental-core/rental-order-request.dto';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { ApprovedOrderBinding } from '../../rental-core/approved-order-transaction.ports';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { isAiStepExecutionContext } from '../task-contract-validation';
import type { AiApprovedOrderAuthority, AiApprovedOrderInput } from './approved-order.ports';

class OrderWriteFailure {
  constructor(readonly cause: unknown) {}
}

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const identityHash = (context: AiExecutionContext) => {
  const { authorizedAt: _time, requestId: _request, ...binding } = context;
  return requestFingerprint(binding);
};

/** Narrow existing order-create route bridge, not a grant to approve or dispatch.
 * Actual approved Core/approval transactions run inside its Guard-owned ALS.
 * Risk exceptions remain unavailable until their Controller-owned confirmations
 * are shared with this application path; a route permission cannot bypass them.
 */
export class AiApprovedOrderRouteAuthority implements AiApprovedOrderAuthority {
  private readonly validation = new ValidationPipe({ transform: true, whitelist: true });
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function') throw denied();
  }

  private async request(binding: ApprovedOrderBinding): Promise<CreateRentalOrderRequest> {
    const raw = structuredClone(binding.request);
    // Do not fabricate confirmedBy/permission/time or silently strip this action.
    if (raw?.capabilityExceptions !== undefined) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const dto = await this.validation.transform(raw, { type: 'body', metatype: CreateRentalOrderDto });
    if (!dto || requestFingerprint(raw) !== requestFingerprint(dto)
      || requestFingerprint({ ...dto, capabilityExceptions: undefined }) !== binding.requestFingerprint) throw denied();
    return structuredClone(dto);
  }

  private async authorized<T>(input: AiApprovedOrderInput, binding: ApprovedOrderBinding,
    action: 'execute' | 'replay', consume: (context: AiExecutionContext, body: CreateRentalOrderRequest, userName: string) => Promise<T>) {
    input = structuredClone(input); binding = structuredClone(binding);
    if (!['execute', 'replay'].includes(action) || !isAiStepExecutionContext(input.context)
      || input.context.actor.kind !== 'user' || input.context.scope.kind !== 'workspace'
      || binding.tenantId !== input.context.scope.tenantId || binding.workspaceId !== input.context.scope.workspaceId
      || binding.idempotencyKey !== input.businessIdempotencyKey || binding.requestFingerprint !== input.actionFingerprint) throw denied();
    const body = await this.request(binding);
    const credential = structuredClone(await this.credentials.current());
    if (!credential || !['operator', 'staff'].includes(credential.audience) || credential.audience !== input.context.audience
      || typeof credential.authorization !== 'string' || credential.authorization.length < 1 || credential.authorization.length > 8192
      || typeof credential.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(credential.requestId)) throw denied();
    return runWithRequestIdentity({}, async () => {
      const staff = credential.audience === 'staff';
      const req: { url: string; originalUrl: string; method: string; headers: object; query: object; body: unknown; staffApiRequest: boolean;
        user?: { id: string; tenantId: string; isActive: boolean; isSaasAdmin?: boolean; displayName: string; permissions: string[] } } = {
        url: '/api/rental/v1/orders', originalUrl: staff ? '/api/staff/v1/orders' : '/api/rental/v1/orders', method: 'POST',
        headers: { authorization: credential.authorization }, query: {}, body: structuredClone(body), staffApiRequest: staff
      };
      if (await this.guard.canActivate(new ExecutionContextHost([req])) !== true) throw denied();
      const user = req.user, identity = getRequestIdentity(), now = this.clock();
      if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || identity.staffApi !== staff
        || identity.userId !== user.id || identity.tenantId !== user.tenantId || !identity.workspaceId
        || typeof user.displayName !== 'string' || !user.displayName || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw denied();
      const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
        audience: credential.audience, actor: { kind: 'user', userId: user.id },
        scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId },
        access: { permissions: user.permissions, dataScope: identity.dataScope, locationScope: identity.locationScope,
          ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) } };
      if (!isAiStepExecutionContext(context) || identityHash(context) !== identityHash(input.context)) throw denied();
      return consume(structuredClone(context), body, user.displayName);
    });
  }

  async resolve(input: AiApprovedOrderInput, binding: ApprovedOrderBinding, action: 'execute' | 'replay', _tx?: Prisma.TransactionClient) {
    try { return await this.authorized(input, binding, action, async context => context); }
    catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw denied(); }
  }

  /** Trusted composition callback must use existing approval participant + Core
   * createApprovedOrder in one transaction. This does not create approvals,
   * bypass DTO/Guard checks, or claim external authorization is DB-atomic. */
  async withOrderWrite<T>(input: AiApprovedOrderInput, binding: ApprovedOrderBinding,
    write: (context: AiExecutionContext, body: CreateRentalOrderRequest, userName: string) => Promise<T>) {
    input = structuredClone(input); binding = structuredClone(binding);
    if (typeof write !== 'function') throw denied();
    try {
      return await this.authorized(input, binding, 'execute', async (context, body, userName) => {
        const value = await write(context, body, userName).catch(error => { throw new OrderWriteFailure(error); });
        const current = await this.resolve(input, binding, 'replay');
        if (identityHash(current) !== identityHash(context)) throw denied();
        return value;
      });
    } catch (error) {
      if (error instanceof OrderWriteFailure) throw error.cause;
      if (error instanceof AiTaskRepositoryError) throw error;
      throw denied();
    }
  }
}
