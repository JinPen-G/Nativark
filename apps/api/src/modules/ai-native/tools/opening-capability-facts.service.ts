/** Minimal original workspace-capability facts under the capability GET Guard.
 * Does not enable/upgrade instances or recalculate Core readiness. Configuration
 * schemas, instance config and operator/contact text never leave this reader. */
import { HttpException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, aiOpeningCapabilityObservationDraft, aiOpeningCapabilitySourceBasis,
  type AiExecutionContext, type AiOpeningCapabilityFactsDraft, type SystemUserRow } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { hasEffectivePermission } from '../../../common/permission-match';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { WorkspaceCapabilityService } from '../../rental-core/workspace-capability.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { assertAiReadContextBinding } from './read-context-binding';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const instant = z.string().max(40).datetime({ offset: true });
// The original service has a larger contract. Parse only the named projection;
// omitted config bodies are neither copied, logged nor used as AI material.
const rawOverview = z.object({ tenantId: id, workspaceId: id, categoryCode: id,
  capabilities: z.array(z.object({ definition: z.object({ code: id, implementationVersion: id.optional() }),
    providedByCore: z.boolean(), declaredByCategory: z.boolean(), requiredForCategory: z.boolean(), implemented: z.boolean(),
    applicable: z.boolean(), state: z.enum(['enabled', 'paused', 'disabled', 'declared_not_implemented', 'not_enabled']),
    upgradeAvailable: z.boolean(), instance: z.object({ tenantId: id, workspaceId: id, code: id,
      status: z.enum(['enabled', 'paused', 'disabled']), implementationVersion: id, configVersion: id,
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), updatedAt: instant }).optional() })).max(128),
  missingRequired: z.array(id).max(128), productionReady: z.boolean() });

export class AiOpeningCapabilityFactsService {
  constructor(private readonly input: { capabilities: Pick<WorkspaceCapabilityService, 'overview'>;
    guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiOrderRouteCredentialSource; clock?: () => Date }) {
    if (typeof input?.capabilities?.overview !== 'function' || typeof input?.guard?.canActivate !== 'function'
      || typeof input?.credentials?.current !== 'function' || input.clock !== undefined && typeof input.clock !== 'function')
      throw new ModelGatewayError('CONFIG_INVALID');
  }
  async read(expectedContext?: AiExecutionContext, signal?: AbortSignal): Promise<AiOpeningCapabilityFactsDraft> {
    const parent = expectedContext && structuredClone(expectedContext), clock = this.input.clock ?? (() => new Date());
    const check = () => { if (signal?.aborted) throw new ModelGatewayError('FORBIDDEN'); };
    const unavailable = (reason: 'current_capability_permission_required' | 'capability_observation_unavailable'): AiOpeningCapabilityFactsDraft =>
      ({ state: 'unavailable', reason, observation: null });
    const authorize = async <T>(consume: (context: AiExecutionContext, binding: string) => Promise<T>): Promise<T> => {
      check(); const credential = structuredClone(await this.input.credentials.current()); check();
      if (credential?.audience !== 'operator' || !id.safeParse(credential.requestId).success
        || typeof credential.authorization !== 'string' || credential.authorization.length > 8192 || !/^Bearer \S+$/u.test(credential.authorization))
        throw new ModelGatewayError('FORBIDDEN');
      return runWithRequestIdentity({}, async () => {
        const request: { url: string; originalUrl: string; method: string; headers: { authorization: string }; query: object;
          staffApiRequest: boolean; user?: SystemUserRow } = { url: '/api/rental/v1/capabilities', originalUrl: '/api/rental/v1/capabilities',
          method: 'GET', headers: { authorization: credential.authorization }, query: {}, staffApiRequest: false };
        if (await this.input.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new ModelGatewayError('FORBIDDEN');
        check(); const user = request.user, identity = structuredClone(getRequestIdentity()), now = clock();
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || identity.audience !== 'operator' || identity.staffApi
          || !identity.workspaceId || identity.userId !== user.id || identity.tenantId !== user.tenantId
          || !['rental-core:capability:view', 'rental-core:capability:manage'].some(permission => hasEffectivePermission(user.permissions, permission))
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('FORBIDDEN');
        const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: 'operator' as const, actor: { kind: 'user' as const, userId: user.id },
          scope: { kind: 'workspace' as const, tenantId: identity.tenantId, workspaceId: identity.workspaceId },
          access: { permissions: [...user.permissions], dataScope: identity.dataScope, locationScope: identity.locationScope,
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) } };
        if (!isAiStepExecutionContext(context)) throw new ModelGatewayError('FORBIDDEN');
        const { requestId: _request, authorizedAt: _time, ...principal } = context;
        return consume(context, requestFingerprint({ principal, session: identity.accessSession ?? null, authorization: credential.authorization }));
      });
    };
    const observe = async (context: AiExecutionContext): Promise<AiOpeningCapabilityFactsDraft> => {
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const value = await this.input.capabilities.overview(context.scope.tenantId); check();
      if (!value || !Array.isArray(value.capabilities) || value.capabilities.length > 128
        || !Array.isArray(value.missingRequired) || value.missingRequired.length > 128) throw new ModelGatewayError('INVALID_RESPONSE');
      const parsed = rawOverview.safeParse(value), now = clock();
      if (!parsed.success || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('INVALID_RESPONSE');
      const row = parsed.data;
      if (row.tenantId !== context.scope.tenantId || row.workspaceId !== context.scope.workspaceId
        || row.capabilities.some(item => item.instance && (item.instance.tenantId !== row.tenantId
          || item.instance.workspaceId !== row.workspaceId || item.instance.code !== item.definition.code)))
        throw new ModelGatewayError('INVALID_RESPONSE');
      const observation = aiOpeningCapabilityObservationDraft.parse({ tenantId: row.tenantId, workspaceId: row.workspaceId,
        categoryCode: row.categoryCode, observedAt: now.toISOString(), source: 'original_workspace_capability_overview',
        capabilities: row.capabilities.map(({ definition, instance, ...facts }) => ({ ...facts, code: definition.code,
          implementationVersion: definition.implementationVersion ?? null, instance: instance ? {
            status: instance.status, implementationVersion: instance.implementationVersion, configVersion: instance.configVersion,
            revision: instance.revision, updatedAt: instance.updatedAt } : null })).sort((a, b) => a.code.localeCompare(b.code)),
        missingRequired: [...row.missingRequired].sort(), productionReady: row.productionReady });
      if (Buffer.byteLength(JSON.stringify(observation), 'utf8') > 65536) throw new ModelGatewayError('INVALID_RESPONSE');
      return { state: 'observed', scope: { ...context.scope }, actorId: context.actor.userId, audience: 'operator', observation };
    };
    let entered = false;
    try {
      return await authorize(async (context, binding) => {
        entered = true; assertAiReadContextBinding(context, parent); check();
        let first: AiOpeningCapabilityFactsDraft | undefined, closing: AiOpeningCapabilityFactsDraft | undefined, failure: unknown, failed = false;
        try { first = await observe(context); } catch (cause) { failure = cause; failed = true; }
        await authorize(async (current, next) => {
          if (next !== binding) throw new ModelGatewayError('FORBIDDEN');
          assertAiReadContextBinding(current, parent); check();
          if (!failed) try { closing = await observe(current); } catch (cause) { failure = cause; failed = true; }
        });
        await authorize(async (current, next) => {
          if (next !== binding) throw new ModelGatewayError('FORBIDDEN');
          assertAiReadContextBinding(current, parent); check();
        });
        if (failed) {
          if (failure instanceof ModelGatewayError && !['CAPABILITY_UNSUPPORTED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT'].includes(failure.code)) throw failure;
          if (failure instanceof HttpException && [401, 403].includes(failure.getStatus())) throw new ModelGatewayError('FORBIDDEN');
          return unavailable('capability_observation_unavailable');
        }
        if (!first || !closing || requestFingerprint(aiOpeningCapabilitySourceBasis(first)) !== requestFingerprint(aiOpeningCapabilitySourceBasis(closing)))
          throw new ModelGatewayError('CONFIG_INVALID');
        return closing;
      });
    } catch (cause) {
      if (!entered && (cause instanceof ModelGatewayError && cause.code === 'FORBIDDEN'
        || cause instanceof HttpException && [401, 403].includes(cause.getStatus()))) return unavailable('current_capability_permission_required');
      if (cause instanceof ModelGatewayError) throw cause;
      throw new ModelGatewayError('FORBIDDEN');
    }
  }
}
