/** Explicit tenant-integration observations under the original management
 * GET Guard/ALS. This independent read never grants itself opening permissions,
 * runs a probe, loads credentials or changes Core readiness's nine decisions. */
import { HttpException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext, type SystemUserRow } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { hasEffectivePermission } from '../../../common/permission-match';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { TenantIntegrationService, TenantOpeningIntegrationObservation } from '../../integrations/tenant-integration.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { assertAiReadContextBinding } from './read-context-binding';

const identifier = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const instant = z.string().datetime({ offset: true });
const querySchema = z.object({ limit: z.number().int().min(1).max(32).optional(), after: identifier.optional() }).strict();
const observationSchema = z.object({ tenantId: identifier, workspaceId: identifier, observedAt: instant,
  items: z.array(z.object({ configId: identifier.nullable(), capability: identifier.max(20), provider: identifier.max(40),
    registered: z.boolean(), implemented: z.boolean(), state: z.enum(['not_loaded', 'not_implemented', 'missing_configuration',
      'configured_unverified', 'mock', 'failed', 'historical_live_success', 'current_live_success']),
    enabled: z.boolean().nullable(), isDefault: z.boolean().nullable(), configurationUpdatedAt: instant.nullable(),
    requiredFields: z.array(identifier.max(64)).max(32), missingFields: z.array(identifier.max(64)).max(32).nullable(),
    structuralConfigurationComplete: z.boolean().nullable(), conditionalFieldsValid: z.boolean().nullable(), credentialMaterialPresent: z.boolean().nullable(),
    test: z.object({ status: z.enum(['not_tested', 'passed', 'failed', 'unknown']), mode: z.enum(['none', 'configuration', 'live', 'mock', 'unknown']),
      checkedAt: instant.nullable(), matchesCurrentConfiguration: z.boolean() }).strict().nullable()
  }).strict()).max(48), hasMore: z.boolean(), nextAfter: identifier.nullable(), limit: z.number().int().min(1).max(32),
  coverage: z.enum(['all_persisted_configuration_records', 'configuration_window']),
  credentialEvidence: z.literal('stored_field_presence_only_not_decrypted') }).strict();
export type AiOpeningIntegrationFacts = {
  state: 'observed'; scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>;
  actorId: string; audience: 'operator'; observation: TenantOpeningIntegrationObservation;
} | { state: 'unavailable'; reason: 'current_integration_permission_required' | 'configuration_observation_unavailable'; observation: null };

export class AiOpeningIntegrationFactsService {
  constructor(private readonly input: {
    integrations: Pick<TenantIntegrationService, 'observeOpeningConfiguration'>;
    guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiOrderRouteCredentialSource; clock?: () => Date;
  }) {
    if (typeof input?.integrations?.observeOpeningConfiguration !== 'function' || typeof input?.guard?.canActivate !== 'function'
      || typeof input?.credentials?.current !== 'function' || input.clock !== undefined && typeof input.clock !== 'function')
      throw new ModelGatewayError('CONFIG_INVALID');
  }

  async read(value: unknown = {}, expectedContext?: AiExecutionContext, signal?: AbortSignal): Promise<AiOpeningIntegrationFacts> {
    const query = querySchema.safeParse(structuredClone(value)), parent = expectedContext && structuredClone(expectedContext);
    if (!query.success) throw new ModelGatewayError('INVALID_REQUEST');
    const clock = this.input.clock ?? (() => new Date()), check = () => { if (signal?.aborted) throw new ModelGatewayError('FORBIDDEN'); };
    const unavailable = (reason: 'current_integration_permission_required' | 'configuration_observation_unavailable'): AiOpeningIntegrationFacts =>
      ({ state: 'unavailable', reason, observation: null });
    const authorize = async <T>(consume: (context: AiExecutionContext, binding: string) => Promise<T>): Promise<T> => {
      check(); const credential = structuredClone(await this.input.credentials.current()); check();
      if (credential?.audience !== 'operator' || !identifier.safeParse(credential.requestId).success
        || typeof credential.authorization !== 'string' || credential.authorization.length > 8192 || !/^Bearer \S+$/u.test(credential.authorization))
        throw new ModelGatewayError('FORBIDDEN');
      return runWithRequestIdentity({}, async () => {
        const request: { url: string; originalUrl: string; method: string; headers: { authorization: string }; query: object;
          staffApiRequest: boolean; user?: SystemUserRow } = { url: '/api/platform/integrations', originalUrl: '/api/platform/integrations',
          method: 'GET', headers: { authorization: credential.authorization }, query: {}, staffApiRequest: false };
        if (await this.input.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new ModelGatewayError('FORBIDDEN');
        check(); const user = request.user, identity = structuredClone(getRequestIdentity()), now = clock();
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || identity.audience !== 'operator' || identity.staffApi
          || !identity.workspaceId || identity.userId !== user.id || identity.tenantId !== user.tenantId
          || !hasEffectivePermission(user.permissions, 'system:integration:manage')
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('FORBIDDEN');
        const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: 'operator' as const, actor: { kind: 'user' as const, userId: user.id },
          scope: { kind: 'workspace' as const, tenantId: identity.tenantId, workspaceId: identity.workspaceId },
          access: { permissions: [...user.permissions], dataScope: identity.dataScope, locationScope: identity.locationScope,
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) } };
        if (!isAiStepExecutionContext(context)) throw new ModelGatewayError('FORBIDDEN');
        const { requestId: _request, authorizedAt: _time, ...principal } = context;
        const binding = requestFingerprint({ principal, session: identity.accessSession ?? null, authorization: credential.authorization });
        return consume(structuredClone(context), binding);
      });
    };
    let entered = false;
    try {
      return await authorize(async (context, binding) => {
        entered = true; assertAiReadContextBinding(context, parent); check();
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
        let observation: unknown, closingObservation: unknown, failure: unknown, failed = false;
        try { observation = structuredClone(await this.input.integrations.observeOpeningConfiguration(query.data, clock)); }
        catch (cause) { failure = cause; failed = true; }
        // Revalidate even a failed source. Permission loss cannot be hidden as
        // a harmless unavailable config, and no stale detail may be delivered.
        await authorize(async (current, next) => {
          if (next !== binding) throw new ModelGatewayError('FORBIDDEN');
          assertAiReadContextBinding(current, parent); check();
          if (!failed) {
            try { closingObservation = structuredClone(await this.input.integrations.observeOpeningConfiguration(query.data, clock)); }
            catch (cause) { failure = cause; failed = true; }
          }
        });
        await authorize(async (current, next) => {
          if (next !== binding) throw new ModelGatewayError('FORBIDDEN');
          assertAiReadContextBinding(current, parent); check();
        });
        if (failed) {
          if (failure instanceof HttpException && [401, 403].includes(failure.getStatus())) throw new ModelGatewayError('FORBIDDEN');
          return unavailable('configuration_observation_unavailable');
        }
        const scope = context.scope;
        const validate = (value: unknown) => {
          const parsed = observationSchema.safeParse(value);
          if (!parsed.success || parsed.data.tenantId !== scope.tenantId || parsed.data.workspaceId !== scope.workspaceId
            || parsed.data.limit !== (query.data.limit ?? 16) || parsed.data.hasMore !== (parsed.data.nextAfter !== null)
            || Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 262144) throw new ModelGatewayError('INVALID_RESPONSE');
          return parsed.data;
        };
        const first = validate(observation), closing = validate(closingObservation);
        const basis = (value: typeof first) => { const { observedAt: _time, ...configuration } = value; return requestFingerprint(configuration); };
        // Guard waits cannot keep an old successful test labelled as current
        // after a config save or test transition. Reobserve the same bounded
        // window, without replaying a probe or inventing a combined revision.
        if (basis(first) !== basis(closing)) throw new ModelGatewayError('CONFIG_INVALID');
        check(); return { state: 'observed', scope: { ...scope }, actorId: context.actor.userId, audience: 'operator', observation: closing };
      });
    } catch (cause) {
      if (!entered && (cause instanceof ModelGatewayError && cause.code === 'FORBIDDEN'
        || cause instanceof HttpException && [401, 403].includes(cause.getStatus()))) return unavailable('current_integration_permission_required');
      if (cause instanceof ModelGatewayError) throw cause;
      throw new ModelGatewayError('FORBIDDEN');
    }
  }
}
