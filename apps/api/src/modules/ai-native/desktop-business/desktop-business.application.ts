/** Current Auth/Guard/ALS -> exact workspace policy -> bounded existing catalog for human preview. No model dispatch. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RentalCategoryCode, RENTAL_DESKTOP_BUSINESS_VERSION, parseRentalDesktopBusinessPolicy,
  parseRentalDesktopCatalogRequest, parseRentalDesktopCatalogResult, parseRentalDesktopBusinessReadRequest,
  parseRentalDesktopCatalogSourcesResult, type RentalDesktopBusinessBinding } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { OperationLogService } from '../../../common/operation-log.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { DesktopBusinessError } from './desktop-business.error';
import { PrismaDesktopBusinessPolicyRepository } from './desktop-business-policy.repository';
import type { PrismaDesktopCatalogSourceRepository } from './desktop-catalog-source.repository';

export interface DesktopBusinessRequest { headers: { authorization?: unknown } }
export interface DesktopBusinessDependencies {
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  core: Pick<RentalCoreService, 'listItemGroupsPage'>;
  policies: PrismaDesktopBusinessPolicyRepository;
  audit: Pick<OperationLogService, 'record'>;
  sources?: PrismaDesktopCatalogSourceRepository;
  clock?: () => Date;
}
const operationKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const saveSchema = z.object({ operationKey, expectedRevision: z.number().int().min(0).max(2147483646), policy: z.unknown() }).strict();
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const fail = (code: ConstructorParameters<typeof DesktopBusinessError>[0]) => new DesktopBusinessError(code);

export function composeDesktopBusinessApplication(dependencies: DesktopBusinessDependencies) {
  if (typeof dependencies.audit?.record !== 'function') throw fail('AI_RESOURCE_UNAVAILABLE');
  const clock = dependencies.clock ?? (() => new Date());
  const call = async (request: DesktopBusinessRequest, value: unknown, action: 'catalog' | 'sources' | 'policy' | 'change' | 'operation', signal?: AbortSignal) => {
    const authorization = bearer.safeParse(request?.headers?.authorization);
    if (!authorization.success) throw fail('AI_ACCESS_DENIED');
    let command: unknown;
    try {
      command = structuredClone(value);
      if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 16384) throw Error();
    } catch { throw fail('AI_INVALID_INPUT'); }
    let active = true;
    const close = () => { active = false; };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    const assertActive = () => { if (!active) throw fail('AI_RESOURCE_UNAVAILABLE'); };
    const requestId = randomUUID();
    const credentials = { current: async () => { assertActive(); return { authorization: authorization.data, requestId, audience: 'operator' as const }; } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        assertActive();
        const identity = new AiTaskCurrentIdentityAuthority(dependencies.auth, credentials, clock);
        const before = await identity.resolve(); assertActive();
        if (before.scope.kind !== 'workspace' || before.actor.kind !== 'user' || before.audience !== 'operator') throw fail('AI_ACCESS_DENIED');
        const binding: RentalDesktopBusinessBinding = { actorId: before.actor.userId, tenantId: before.scope.tenantId, workspaceId: before.scope.workspaceId };
        const revalidate = async () => {
          assertActive();
          if (originalIdentityHash(await identity.resolve()) !== originalIdentityHash(before)) throw fail('AI_SCOPE_CHANGED');
          assertActive();
        };
        const configuration = new TenantModelConfigurationAuthority(dependencies.guard, credentials, identity);
        const manage = async () => { assertActive(); await configuration.authorize(binding, 'manage'); await revalidate(); };
        if (action === 'sources') {
          let input;
          try { input = parseRentalDesktopBusinessReadRequest(command); } catch { throw fail('AI_INVALID_INPUT'); }
          if (!('kind' in input) || input.kind !== 'catalog_sources') throw fail('AI_INVALID_INPUT');
          if (requestFingerprint(input.binding) !== requestFingerprint(binding)) throw fail('AI_SCOPE_CHANGED');
          if (!dependencies.sources) throw fail('AI_RESOURCE_UNAVAILABLE');
          const authority = new AiBusinessReadRouteAuthority(dependencies.guard, credentials, clock);
          return authority.withRead('catalog', { limit: input.query.limit }, async authorized => {
            if (authorized.actor.kind !== 'user' || authorized.actor.userId !== binding.actorId || authorized.scope.kind !== 'workspace'
              || authorized.scope.tenantId !== binding.tenantId || authorized.scope.workspaceId !== binding.workspaceId) throw fail('AI_SCOPE_CHANGED');
            const observedAt = clock().toISOString();
            const page = await dependencies.sources!.list(binding, input.query.limit, originalIdentityHash(authorized), new Date(observedAt));
            assertActive(); await revalidate();
            const result = parseRentalDesktopCatalogSourcesResult({ version: RENTAL_DESKTOP_BUSINESS_VERSION, requestId: input.id,
              binding, observedAt, expiresAt: new Date(Date.parse(observedAt) + 60_000).toISOString(), ...page, execution: 'references_only' });
            await runWithRequestIdentity({ tenantId: binding.tenantId, workspaceId: binding.workspaceId, userId: binding.actorId }, () =>
              dependencies.audit.record({ tenantId: binding.tenantId, userId: binding.actorId, action: 'ai.desktop.catalog.sources.read',
                targetType: 'rental.catalog.search', targetId: input.id, requireSuccess: true, metadata: { rowCount: result.items.length, modelRequest: 'not_sent' } }));
            assertActive(); await revalidate();
            if (Date.parse(result.expiresAt) <= clock().getTime()) throw fail('AI_RESOURCE_UNAVAILABLE');
            return result;
          });
        }
        if (action !== 'catalog') {
          await manage();
          if (action === 'policy') {
            if (!z.object({}).strict().safeParse(command).success) throw fail('AI_INVALID_INPUT');
            const result = await dependencies.policies.read(binding); await manage(); return result;
          }
          if (action === 'operation') {
            const parsed = z.object({ operationKey }).strict().safeParse(command);
            if (!parsed.success) throw fail('AI_INVALID_INPUT');
            const result = await dependencies.policies.operation(binding, parsed.data.operationKey); await manage(); return result;
          }
          const parsed = saveSchema.safeParse(command);
          if (!parsed.success) throw fail('AI_INVALID_INPUT');
          let policy;
          try { policy = parseRentalDesktopBusinessPolicy(parsed.data.policy); }
          catch { throw fail('AI_INVALID_INPUT'); }
          if (policy.enabled && Date.parse(policy.expiresAt) <= clock().getTime()) throw fail('AI_INVALID_INPUT');
          const result = await dependencies.policies.save(binding, { ...parsed.data, policy }, manage);
          try { await manage(); } catch { throw fail('AI_RESULT_UNKNOWN'); }
          return result;
        }
        let input;
        try { input = parseRentalDesktopCatalogRequest(command); } catch { throw fail('AI_INVALID_INPUT'); }
        if (requestFingerprint(input.binding) !== requestFingerprint(binding)) throw fail('AI_SCOPE_CHANGED');
        const policy = await dependencies.policies.read(binding); assertActive();
        if (policy.state !== 'configured' || !policy.policy.enabled || !policy.policy.toolCodes.includes('rental.catalog.search')
          || Date.parse(policy.policy.expiresAt) <= clock().getTime()) throw fail('AI_RESOURCE_UNAVAILABLE');
        if (input.query.limit > policy.policy.maxRows || !policy.policy.destinations.some(destination => requestFingerprint(destination) === requestFingerprint(input.query.destination)))
          throw fail('AI_ACCESS_DENIED');
        if (input.query.modelRoute && !policy.policy.modelRoutes?.some(route => requestFingerprint(route) === requestFingerprint(input.query.modelRoute)))
          throw fail('AI_ACCESS_DENIED');
        await revalidate();
        const authority = new AiBusinessReadRouteAuthority(dependencies.guard, credentials, clock);
        return authority.withRead('catalog', { limit: input.query.limit }, async authorized => {
        assertActive();
        if (authorized.actor.kind !== 'user' || authorized.actor.userId !== binding.actorId || authorized.scope.kind !== 'workspace'
          || authorized.scope.tenantId !== binding.tenantId || authorized.scope.workspaceId !== binding.workspaceId) throw fail('AI_SCOPE_CHANGED');
        const original = input.query.sourceRef
          ? await dependencies.sources?.resolve(binding, input.query.sourceRef, originalIdentityHash(authorized), clock()) : undefined;
        assertActive();
        if (input.query.sourceRef && (!original || requestFingerprint(original.query) !== requestFingerprint({ limit: input.query.limit,
          destination: input.query.destination, modelRoute: input.query.modelRoute }))) throw fail('AI_SCOPE_CHANGED');
        // Compare reader facts against the Guard-expanded scope, not Auth's raw organization/location settings.
        // The enclosing authority also rechecks that scope after the audit before disclosing this result.
        const reader = new AiCatalogReadFactsService(dependencies.core, authority, clock);
        const facts = await reader.read({ limit: input.query.limit }, authorized); assertActive();
        if (facts.items.some(item => !Object.values(RentalCategoryCode).includes(item.categoryCode as RentalCategoryCode))) throw fail('AI_RESOURCE_UNAVAILABLE');
        await revalidate();
        const verifyPolicy = async () => {
          const current = await dependencies.policies.read(binding); assertActive();
          if (current.state !== 'configured' || requestFingerprint(current) !== requestFingerprint(policy)
            || !current.policy.enabled || Date.parse(current.policy.expiresAt) <= clock().getTime()) throw fail('AI_SCOPE_CHANGED');
          await revalidate();
        };
        await verifyPolicy();
        const observedAt = facts.observedAt;
        const result = parseRentalDesktopCatalogResult({ version: RENTAL_DESKTOP_BUSINESS_VERSION, requestId: input.id,
          binding, policyRevision: policy.revision, policyHash: requestFingerprint(policy), observedAt,
          expiresAt: new Date(Math.min(Date.parse(policy.policy.expiresAt), Date.parse(observedAt) + 60_000)).toISOString(),
          configurationVersion: facts.configurationVersion, source: facts.source, destination: input.query.destination,
          ...input.query.modelRoute ? { modelRoute: input.query.modelRoute } : {},
          ...original ? { reopenedFrom: { auditId: original.auditId, requestId: original.requestId,
            observedAt: original.observedAt, configurationVersion: original.configurationVersion } } : {},
          items: facts.items.map(item => ({ reference: `catalog:${item.id}`, categoryCode: item.categoryCode, status: item.status })),
          truncated: facts.truncated, omittedFields: ['name', 'code', 'unit', 'availability', 'price'], execution: 'read_only' });
        // Reuse durable business audit before disclosure; never log names, raw input, credentials or model content.
        await runWithRequestIdentity({ tenantId: binding.tenantId, workspaceId: binding.workspaceId, userId: binding.actorId }, () =>
          dependencies.audit.record({ tenantId: binding.tenantId, userId: binding.actorId, action: 'ai.desktop.catalog.preview',
            targetType: 'rental.catalog.search', targetId: input.id, requireSuccess: true,
            metadata: { policyRevision: result.policyRevision, policyHash: result.policyHash, configurationVersion: result.configurationVersion,
              observedAt, rowCount: result.items.length, truncated: result.truncated, modelRequest: 'not_sent',
              ...input.query.modelRoute ? { modelRouteHash: requestFingerprint(input.query.modelRoute), catalogSource: {
                version: 1, accessHash: originalIdentityHash(authorized), reference: {
                  state: 'reference', requestId: input.id, observedAt,
                  sourceExpiresAt: new Date(Date.parse(observedAt) + 30 * 86400000).toISOString(),
                  query: { limit: input.query.limit, destination: input.query.destination, modelRoute: input.query.modelRoute },
                  configurationVersion: result.configurationVersion, policyRevision: result.policyRevision, policyHash: result.policyHash
                } } } : {} } }));
        assertActive(); await verifyPolicy();
        if (Date.parse(result.expiresAt) <= clock().getTime()) throw fail('AI_RESOURCE_UNAVAILABLE');
        return result;
        });
      }), action === 'change', signal);
    } catch (error) {
      if (action === 'change' && !(error instanceof AiTaskRepositoryError) && !(error instanceof DesktopBusinessError)) throw fail('AI_RESULT_UNKNOWN');
      throw error;
    } finally { active = false; signal?.removeEventListener('abort', close); }
  };
  return Object.freeze({
    catalog: (request: DesktopBusinessRequest, value: unknown, signal?: AbortSignal) => call(request, value, 'catalog', signal),
    readCatalogSources: (request: DesktopBusinessRequest, value: unknown, signal?: AbortSignal) => call(request, value, 'sources', signal),
    readPolicy: (request: DesktopBusinessRequest, value: unknown, signal?: AbortSignal) => call(request, value, 'policy', signal),
    changePolicy: (request: DesktopBusinessRequest, value: unknown, signal?: AbortSignal) => call(request, value, 'change', signal),
    readPolicyOperation: (request: DesktopBusinessRequest, value: unknown, signal?: AbortSignal) => call(request, value, 'operation', signal)
  });
}
