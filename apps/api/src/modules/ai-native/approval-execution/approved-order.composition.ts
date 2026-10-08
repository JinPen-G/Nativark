import type { AiExecutionContext } from '@rental-os/shared';
import type { BusinessContext } from '../../rental-core/rental-business.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { PrismaAiApprovalConsumptionRepository } from '../prisma-approval-consumption.repository';
import { AiApprovedOrderRouteAuthority } from './approved-order-route.authority';
import type { AiApprovedOrderAuthority } from './approved-order.ports';
import type { ApprovedOrderCompositionDependencies } from './approved-order-composition.ports';
import { approvedOrderCommandSchema, deniedOrder, orderContextHash, PrismaApprovedOrderSource } from './prisma-approved-order.source';

import { AiApprovedOrderResultUnknownError } from './approved-order.errors';
import { AiScopeResolutionError } from '../ai-scope.repository';
export { AiApprovedOrderResultUnknownError } from './approved-order.errors';

export function composeAiApprovedOrder(dependencies: ApprovedOrderCompositionDependencies) {
  const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (!dependencies || !dependencies.db || typeof dependencies.db.$transaction !== 'function'
    || typeof dependencies.guard?.canActivate !== 'function' || typeof dependencies.credentials?.current !== 'function'
    || typeof dependencies.policy?.resolve !== 'function' || typeof dependencies.snapshots?.read !== 'function'
    || typeof dependencies.confirmation?.createApprovedOrder !== 'function' || typeof dependencies.quoteFacts?.findQuote !== 'function'
    || typeof dependencies.toolVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(dependencies.toolVersion)
    || (dependencies.executionInput && typeof dependencies.executionInput.readAuthorized !== 'function')) throw unavailable();
  const coreMethods = ['resolveWorkspaceId', 'getProfile', 'getWorkspaceCategory', 'getBusinessSettings', 'listItemGroups',
    'listPricingGroups', 'listCouponTemplates', 'listLocations', 'listOperators', 'getOrder'] as const;
  if (coreMethods.some(method => typeof dependencies.core?.[method] !== 'function')
    || ['aiTask', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovalConsumption']
      .some(name => typeof (dependencies.db[name as keyof typeof dependencies.db] as { findFirst?: unknown })?.findFirst !== 'function')) throw unavailable();
  const core = dependencies.core;
  const methods = { resolveWorkspaceId: core.resolveWorkspaceId.bind(core), getProfile: core.getProfile.bind(core),
    getWorkspaceCategory: core.getWorkspaceCategory.bind(core), getBusinessSettings: core.getBusinessSettings.bind(core),
    listItemGroups: core.listItemGroups.bind(core), listPricingGroups: core.listPricingGroups.bind(core),
    listCouponTemplates: core.listCouponTemplates.bind(core), listLocations: core.listLocations.bind(core),
    listOperators: core.listOperators.bind(core), getOrder: core.getOrder.bind(core) };
  const d = { ...dependencies, core: methods,
    policy: { resolve: dependencies.policy.resolve.bind(dependencies.policy) },
    snapshots: { read: dependencies.snapshots.read.bind(dependencies.snapshots) },
    executionInput: dependencies.executionInput ? {
      read: dependencies.executionInput.read.bind(dependencies.executionInput),
      readAuthorized: dependencies.executionInput.readAuthorized.bind(dependencies.executionInput)
    } : undefined,
    guard: { canActivate: dependencies.guard.canActivate.bind(dependencies.guard) },
    credentials: { current: dependencies.credentials.current.bind(dependencies.credentials) },
    quoteFacts: { findQuote: dependencies.quoteFacts.findQuote.bind(dependencies.quoteFacts) } };
  const create = dependencies.confirmation.createApprovedOrder.bind(dependencies.confirmation);
  const source = new PrismaApprovedOrderSource(d);
  const repository = new PrismaAiApprovalConsumptionRepository(d.db, d.clock);
  const route = new AiApprovedOrderRouteAuthority(d.guard, d.credentials, d.clock);
  const withRead = async <T>(id: string, context: AiExecutionContext, read: () => Promise<T>) => {
    const result = await new AiOrderRouteContextAuthority(d.guard, d.credentials, id, d.clock).withOrderRead(async current => {
      if (orderContextHash(current) !== orderContextHash(context)) throw deniedOrder();
      try { return { ok: true as const, value: await read() }; }
      catch (error) {
        if (error instanceof AiTaskRepositoryError || error instanceof AiScopeResolutionError) throw error;
        // Let the Guard recheck access before reporting an uncertain committed fact.
        return { ok: false as const };
      }
    });
    if (!result.ok) throw new AiApprovedOrderResultUnknownError();
    return result.value;
  };

  const run = async (value: unknown, recoveryOnly: boolean) => {
    let effectPossible = false;
    try {
      const parsed = approvedOrderCommandSchema.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = structuredClone(parsed.data);
      const original = await source.read(command, recoveryOnly ? 'replay' : 'inspect');
      effectPossible = !!original.committedId;
      const same = (current: typeof original) => {
        if (orderContextHash(current.input.context) !== orderContextHash(original.input.context)
          || requestFingerprint(current.binding) !== requestFingerprint(original.binding)
          || current.payloadHash !== original.payloadHash || current.previewHash !== original.previewHash
          || (current.operation === 'execute' && current.inputBindingHash !== original.inputBindingHash)) throw deniedOrder();
      };
      const authority: AiApprovedOrderAuthority = {
        resolve: async (_input, binding, action, tx) => {
          if (requestFingerprint(binding) !== requestFingerprint(original.binding)) throw deniedOrder();
          const current = await source.read(command, tx && action === 'execute' ? 'execute' : 'inspect', tx);
          same(current);
          if (current.operation === 'replay' && current.committedId) {
            return withRead(current.committedId, current.input.context, async () => structuredClone(current.input.context));
          }
          return route.resolve(current.input, current.binding, action, tx);
        }
      };
      const participant = repository.createOrderTransaction(original.input, authority);
      const resultFact = async (orderId: string) => withRead(orderId, original.input.context, async () => {
        const current = await source.read(command, 'replay');
        same(current);
        if (current.committedId !== orderId) throw deniedOrder();
        await participant.replay(original.binding, orderId);
        const order = await d.core.getOrder(original.binding.tenantId, orderId);
        if (!order || order.id !== orderId || order.tenantId !== original.binding.tenantId
          || d.core.resolveWorkspaceId(original.binding.tenantId) !== original.binding.workspaceId) throw deniedOrder();
        const latest = await source.read(command, 'replay');
        same(latest);
        if (latest.committedId !== orderId) throw deniedOrder();
        return order;
      });
      if (original.committedId) return { order: await resultFact(original.committedId), replayed: true };
      const result = await route.withOrderWrite(original.input, original.binding, async (context, body, userName) => {
        if (context.scope.kind !== 'workspace' || d.core.resolveWorkspaceId(context.scope.tenantId) !== context.scope.workspaceId) throw deniedOrder();
        const tenantId = context.scope.tenantId;
        const business: BusinessContext = { profile: d.core.getProfile(tenantId), category: await d.core.getWorkspaceCategory(tenantId),
          settings: d.core.getBusinessSettings(tenantId), groups: d.core.listItemGroups(tenantId), pricingGroups: d.core.listPricingGroups(tenantId),
          couponTemplates: d.core.listCouponTemplates(tenantId), locations: d.core.listLocations(tenantId), operators: d.core.listOperators(tenantId) };
        await authority.resolve(original.input, original.binding, 'execute');
        effectPossible = true;
        try { return await create(tenantId, body, userName, business, original.input.businessIdempotencyKey, participant); }
        catch { throw new AiApprovedOrderResultUnknownError(); }
      });
      return { order: await resultFact(result.order.id), replayed: result.replayed };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      if (error instanceof AiScopeResolutionError) throw new AiScopeResolutionError(error.code);
      if (effectPossible || error instanceof AiApprovedOrderResultUnknownError) throw new AiApprovedOrderResultUnknownError();
      throw unavailable();
    }
  };
  return Object.freeze({ submit: (value: unknown) => run(value, false), reconcile: (value: unknown) => run(value, true) });
}
