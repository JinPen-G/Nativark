/** Fixed original-resource navigation. Server publication, current Guard/ALS,
 * owner and resource versions are checked before issue and again before use.
 * No model, runner, business write or provider refresh is invoked here. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { SecretBox } from '../../../common/secret-box';
import type { ClientApiService } from '../../client/client-api.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AI_CONTRACT_DRAFT_VERSION, AI_REGISTERED_ENTRY_ACTION_VERSION, AI_ENTRY_ACTION_REGISTRY,
  AI_REGISTERED_ENTRY_SURFACE_AUDIENCE, aiRegisteredEntryActionSchema, aiRegisteredEntryActionIssueSchema,
  aiRegisteredEntryActionReadSchema, aiRegisteredEntryActionOrderSourceSchema,
  aiRegisteredEntryActionObservationSchema, aiRegisteredEntryActionRevalidationSchema,
  aiRegisteredEntryActionOrderResponseSchema, type AiExecutionContext, type AiEntryActionCode,
  type AiRegisteredEntrySurface, type AiRegisteredEntryAction, type AiRegisteredEntryActionObservation,
  type AiRegisteredEntryActionOrderSource } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { createAiGuardedClientSession } from '../client-scene.composition';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { readRuntimePublication } from '../runtime-publication.configuration';
import { createEntryActionResourceReader } from './entry-action-resource.reader';
import { readStandardClientEntryPublication } from './standard-client-entry.application';
import type { composeRequestBoundTaskOrderHandoff } from '../task-order-handoff.application';

type Request = { headers: { authorization?: unknown }; ip?: string };
type Observation = { context: AiExecutionContext; ownerKey: string; resource: AiRegisteredEntryAction['resource'];
  label: string; observedAt: string; orderId?: string; authorityFingerprint?: string; clientPublication?: string };
type Source = AiRegisteredEntryActionOrderSource;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const stale = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const date = z.string().max(40).datetime({ offset: true });
const configurationSchema = z.object({ enabled: z.boolean(), ttlMs: z.number().int().min(1).max(120000),
  validFrom: date, expiresAt: date }).strict();
const paymentRow = z.object({ id: z.string().min(1).max(191), orderId: z.string().min(1).max(191),
  status: z.string().min(1).max(32), instrument: z.string().min(1).max(24), updatedAt: z.date() }).strict();
const NAVIGATION_CODES = ['OPEN_ORDER', 'OPEN_CUSTOMER', 'OPEN_PRODUCT', 'OPEN_PROFILE', 'OPEN_PAYMENT', 'OPEN_DISPATCH'] as const;
export interface RegisteredEntryActionDependencies {
  db: PrismaClient;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'> & Partial<Pick<ApiAuthGuard, 'revalidateClientRead'>>;
  secrets: Pick<SecretBox, 'encrypt' | 'decrypt'>;
  publication: Pick<ConfigService, 'get'>;
  core: Pick<RentalCoreService, 'readOrderFacts' | 'listItemGroupsPage'>;
  client: Pick<ClientApiService, 'getOrder' | 'readOwnProfileNavigation' | 'readClientProductNavigation' | 'readOwnPaymentNavigation' | 'readOwnOrderNavigationSources'>;
  orderHandoff: Pick<ReturnType<typeof composeRequestBoundTaskOrderHandoff>, 'read'>;
  clock?(): Date;
}
export type RegisteredEntryActionFactory = ReturnType<typeof composeRegisteredEntryActionRequests>;

export function composeRegisteredEntryActionRequests(d: RegisteredEntryActionDependencies, surface: AiRegisteredEntrySurface) {
  return (request: Request) => {
    const audience = AI_REGISTERED_ENTRY_SURFACE_AUDIENCE[surface];
    if (!audience || typeof request?.headers?.authorization !== 'string'
      || request.headers.authorization.length > 8192 || !/^Bearer \S+$/u.test(request.headers.authorization)) throw denied();
    const authorization = request.headers.authorization, requestId = randomUUID(), clock = d.clock ?? (() => new Date());
    const boundRequest = Object.freeze({ headers: Object.freeze({ authorization }), ip: request.ip });
    let active = true;
    const check = (signal?: AbortSignal) => { if (!active || signal?.aborted) throw denied(); };
    const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
    const credentials = { current: async () => { check(); return { authorization, requestId,
      audience: audience === 'staff' ? 'staff' as const : 'operator' as const }; } };
    const resources = createEntryActionResourceReader({ db: d.db, core: d.core, guard: d.guard, credentials, clock });
    const clientSession = createAiGuardedClientSession(d.guard, { current: async () => { check(); return { authorization, ip: request.ip }; } });
    const configuration = () => {
      const publication = readRuntimePublication(d.publication), parsed = configurationSchema.safeParse(publication.configurations.entryActions);
      const time = now().getTime();
      if (publication.state !== 'configured' || !parsed.success || !parsed.data.enabled
        || Date.parse(parsed.data.validFrom) > time || Date.parse(parsed.data.expiresAt) <= time) throw unavailable();
      return { ...parsed.data, revision: publication.revision, fingerprint: requestFingerprint({ revision: publication.revision, ...parsed.data }) };
    };
    const principal = async (signal?: AbortSignal) => {
      check(signal);
      if (audience === 'customer') {
        const identity = await clientSession.current(); check(signal);
        const context: AiExecutionContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId,
          authorizedAt: now().toISOString(), audience: 'client', actor: { kind: 'customer', customerId: identity.customerId },
          scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId } };
        return { context, ownerKey: requestFingerprint({ tenantId: identity.tenantId, workspaceId: identity.workspaceId,
          customerId: identity.customerId, customerType: identity.customerType, sessionId: identity.sessionId,
          categoryCode: identity.categoryCode, workspaceCode: identity.workspaceCode, tenantCode: identity.tenantCode }), identity };
      }
      const context = await new AiTaskCurrentIdentityAuthority(d.auth, credentials, clock).resolve(); check(signal);
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== credentialsAudience()) throw denied();
      return { context, ownerKey: originalIdentityHash(context), identity: undefined };
    };
    const credentialsAudience = () => audience === 'staff' ? 'staff' : 'operator';
    const currentRow = async (id: string, context: AiExecutionContext) => {
      if (context.scope.kind !== 'workspace') throw denied();
      const value = await d.db.rentalPaymentIntent.findFirst({ where: { id, tenantId: context.scope.tenantId,
        workspaceId: context.scope.workspaceId }, select: { id: true, orderId: true, status: true, instrument: true, updatedAt: true } });
      const parsed = paymentRow.safeParse(value); if (!parsed.success) throw unavailable(); return parsed.data;
    };
    const readResource = async (code: AiEntryActionCode, targetId: string, signal?: AbortSignal): Promise<Observation> => {
      check(signal);
      const before = await principal(signal);
      if (!(AI_ENTRY_ACTION_REGISTRY[code].audiences as readonly string[]).includes(audience)
        || !(NAVIGATION_CODES as readonly string[]).includes(code)) throw unavailable();
      let found: Observation;
      if (audience === 'customer') {
        if (!before.identity) throw denied();
        const channel = surface === 'tenant_website' ? 'web' as const : 'wechat_miniprogram' as const;
        const scene = { sceneCode: code === 'OPEN_ORDER' || code === 'OPEN_PAYMENT' ? 'order_explanation' : 'quote_clarification', sceneVersion: '1' };
        const publication = await readStandardClientEntryPublication(d.db, before.identity, channel, scene, now());
        let resource: AiRegisteredEntryAction['resource'], label: string, orderId: string | undefined;
        if (code === 'OPEN_PROFILE') {
          if (targetId !== before.identity.customerId) throw denied();
          const profile = await clientSession.withRead!('profile', {}, identity => d.client.readOwnProfileNavigation(identity));
          resource = { kind: 'customer_profile', id: profile.id, resourceVersion: profile.resourceVersion }; label = profile.name;
        } else if (code === 'OPEN_PRODUCT') {
          const product = await clientSession.withRead!('catalog', {}, identity => d.client.readClientProductNavigation(identity, targetId));
          resource = { kind: 'item_group', id: product.id, resourceVersion: product.resourceVersion }; label = product.name;
        } else if (code === 'OPEN_ORDER') {
          const order = await clientSession.withRead!('order', targetId, identity => d.client.getOrder(identity, targetId));
          resource = { kind: 'order', id: order.id, resourceVersion: requestFingerprint({ id: order.id, status: order.status, updatedAt: order.updatedAt }) };
          label = order.orderNo;
        } else if (code === 'OPEN_PAYMENT') {
          const row = await currentRow(targetId, before.context);
          const payment = await clientSession.withRead!('paymentNavigation', { orderId: row.orderId, intentId: row.id },
            identity => d.client.readOwnPaymentNavigation(identity, row.orderId, row.id));
          resource = { kind: 'payment', id: payment.id, resourceVersion: payment.resourceVersion }; label = `${payment.status} · ${payment.id}`;
          orderId = payment.orderId;
        } else throw unavailable();
        found = { context: before.context, ownerKey: before.ownerKey, resource, label: label.slice(0, 191), observedAt: now().toISOString(),
          clientPublication: publication.releaseRevision, ...(orderId ? { orderId } : {}) };
        const closingPublication = await readStandardClientEntryPublication(d.db, before.identity, channel, scene, now());
        if (closingPublication.releaseRevision !== publication.releaseRevision) throw stale();
      } else if (code === 'OPEN_PAYMENT') {
        const row = await currentRow(targetId, before.context);
        const authority = new AiOrderRouteContextAuthority(d.guard, credentials, row.orderId, clock);
        const routes = new AiBusinessReadRouteAuthority(d.guard, credentials, clock);
        found = await authority.withOrderRead(async (context, orderId) => {
          if (originalIdentityHash(context) !== before.ownerKey || context.scope.kind !== 'workspace') throw denied();
          const order = await d.core.readOrderFacts(context.scope.tenantId, orderId);
          return routes.withRead('payment_intents', { orderId }, async current => {
            if (originalIdentityHash(current) !== before.ownerKey) throw denied();
            const latest = await currentRow(targetId, current);
            if (latest.orderId !== row.orderId || requestFingerprint({ ...row, updatedAt: row.updatedAt.toISOString() })
              !== requestFingerprint({ ...latest, updatedAt: latest.updatedAt.toISOString() })) throw stale();
            const again = await d.core.readOrderFacts(context.scope.kind === 'workspace' ? context.scope.tenantId : '', orderId);
            if (requestFingerprint(again) !== requestFingerprint(order)) throw stale();
            return { context: current, ownerKey: before.ownerKey, resource: { kind: 'payment' as const, id: row.id,
              resourceVersion: requestFingerprint({ ...row, updatedAt: row.updatedAt.toISOString(), orderVersion: order.updatedAt }) },
              label: `${row.status} · ${row.id}`.slice(0, 191), observedAt: now().toISOString(), orderId: row.orderId };
          });
        });
      } else {
        const original = await resources.read({ actionCode: code, targetId }, signal);
        if (original.context.actor.kind !== 'user' || before.context.actor.kind !== 'user'
          || original.context.actor.userId !== before.context.actor.userId || original.context.audience !== before.context.audience
          || before.context.scope.kind !== 'workspace'
          || original.context.scope.tenantId !== before.context.scope.tenantId
          || original.context.scope.kind === 'workspace' && original.context.scope.workspaceId !== before.context.scope.workspaceId
          || original.context.scope.kind === 'tenant' && code !== 'OPEN_CUSTOMER') throw denied();
        // Membership remains tenant-authorized; current workspace is a separate
        // Action/host binding, never an invented membership grant.
        found = { ...original, context: before.context, ownerKey: before.ownerKey,
          resource: original.resource,
          authorityFingerprint: originalIdentityHash(original.context) } as Observation;
      }
      check(signal); const after = await principal(signal);
      if (after.ownerKey !== before.ownerKey || originalIdentityHash(after.context) !== originalIdentityHash(found.context)) throw denied();
      return found;
    };
    const sameResource = (a: Observation, b: Observation) => {
      if (a.ownerKey !== b.ownerKey || originalIdentityHash(a.context) !== originalIdentityHash(b.context)) throw denied();
      if (a.authorityFingerprint !== b.authorityFingerprint) throw denied();
      if (a.clientPublication !== b.clientPublication) throw denied();
      if (requestFingerprint(a.resource) !== requestFingerprint(b.resource)) throw stale();
    };
    const linkedHash = (value: Awaited<ReturnType<typeof linked>>) => requestFingerprint({
      source: value.source, origin: value.origin, orderId: value.orderId, orderVersion: value.orderVersion,
      context: originalIdentityHash(value.targets.context), order: value.targets.order,
      customer: value.targets.customer, productIds: value.targets.productIds,
    });
    const linked = async (source: Source, signal?: AbortSignal) => {
      if (audience === 'customer') {
        if (!('orderId' in source)) throw unavailable();
        const before = await principal(signal);
        if (!before.identity || before.context.scope.kind !== 'workspace') throw denied();
        const original = await clientSession.withRead!('order', source.orderId,
          identity => d.client.readOwnOrderNavigationSources(identity, source.orderId));
        const after = await principal(signal);
        if (before.ownerKey !== after.ownerKey) throw denied();
        return { targets: { context: after.context, order: { id: original.orderId, version: original.orderVersion,
          resourceVersion: original.resourceVersion, assignmentRevision: null },
          customer: { id: original.customerId, type: before.identity.customerType }, productIds: original.productIds, observedAt: now().toISOString() },
          source: { orderId: original.orderId } as Source, scope: before.context.scope, orderId: original.orderId,
          orderVersion: original.orderVersion, origin: null, paymentIds: original.paymentIds,
          task: null as { taskId: string; runId: string } | null };
      }
      if ('orderId' in source) {
        const targets = await resources.targetsFromOrder(source.orderId, signal); check(signal);
        if (targets.context.scope.kind !== 'workspace') throw denied();
        return { targets, source: { orderId: targets.order.id } as Source, scope: targets.context.scope,
          orderId: targets.order.id, orderVersion: targets.order.version, origin: null,
          task: null as { taskId: string; runId: string } | null, paymentIds: [] as string[] };
      }
      if (audience !== 'operations') throw unavailable();
      const handoff = await d.orderHandoff.read(boundRequest, source, signal);
      const targets = await resources.targetsFromOrder(handoff.order.id, signal); check(signal);
      if (targets.context.scope.kind !== 'workspace' || handoff.scope.tenantId !== targets.context.scope.tenantId
        || handoff.scope.workspaceId !== targets.context.scope.workspaceId || handoff.order.version !== targets.order.version) throw stale();
      return { targets, source: { taskId: handoff.taskId, runId: handoff.runId } as Source, scope: handoff.scope,
        orderId: handoff.order.id, orderVersion: handoff.order.version, origin: handoff.origin,
        task: { taskId: handoff.taskId, runId: handoff.runId }, paymentIds: [] as string[] };
    };
    const belongs = async (code: AiEntryActionCode, targetId: string, binding: Awaited<ReturnType<typeof linked>>) => {
      if (code === 'OPEN_ORDER' || code === 'OPEN_DISPATCH') return targetId === binding.orderId;
      if (code === 'OPEN_CUSTOMER') return targetId === binding.targets.customer?.id;
      if (code === 'OPEN_PROFILE') return audience === 'customer' && targetId === binding.targets.customer?.id;
      if (code === 'OPEN_PRODUCT') return binding.targets.productIds.includes(targetId);
      if (code === 'OPEN_PAYMENT') return (await currentRow(targetId, binding.targets.context)).orderId === binding.orderId;
      return false;
    };
    const sign = async (code: AiEntryActionCode, targetId: string, source: Source | undefined,
      signal?: AbortSignal): Promise<AiRegisteredEntryActionObservation> => {
      const config = configuration(), initial = await readResource(code, targetId, signal);
      const linkage = source ? await linked(source, signal) : undefined;
      if (linkage && !await belongs(code, targetId, linkage)) throw denied();
      const latest = await readResource(code, targetId, signal); sameResource(initial, latest);
      if (linkage) {
        const closing = await linked(linkage.source, signal);
        if (linkedHash(closing) !== linkedHash(linkage)) throw stale();
      }
      if (configuration().fingerprint !== config.fingerprint) throw stale();
      check(signal); const time = now(), rule = AI_ENTRY_ACTION_REGISTRY[code];
      if (latest.context.scope.kind !== 'workspace') throw denied();
      const body = { contractVersion: AI_REGISTERED_ENTRY_ACTION_VERSION, actionId: randomUUID(), actionCode: code, audience,
        surface, scope: latest.context.scope, resource: latest.resource, requiresConfirmation: rule.requiresConfirmation,
        riskLevel: rule.riskLevel, issuedAt: time.toISOString(), expiresAt: new Date(Math.min(time.getTime() + config.ttlMs,
          Date.parse(config.expiresAt))).toISOString(), inputFingerprint: requestFingerprint({ code, targetId, source: linkage?.source ?? null }),
        bindingFingerprint: latest.ownerKey, policyFingerprint: requestFingerprint({ principal: originalIdentityHash(latest.context),
          originalAuthority: latest.authorityFingerprint ?? originalIdentityHash(latest.context),
          clientPublication: latest.clientPublication ?? null,
          resource: latest.resource, publication: config.fingerprint }), associations: { materialRef: null, taskId: linkage?.task?.taskId ?? null,
          runId: linkage?.task?.runId ?? null, proposalId: null, quoteId: null, bookingDraftId: null,
          orderId: linkage?.orderId ?? latest.orderId ?? (code === 'OPEN_ORDER' || code === 'OPEN_DISPATCH' ? targetId : null) } };
      const proof = d.secrets.encrypt({ purpose: 'rental-os:registered-entry-action:2', ownerKey: latest.ownerKey,
        publication: config.fingerprint, bodyHash: requestFingerprint(body), source: JSON.stringify(linkage?.source ?? null),
        sourceHash: linkage ? linkedHash(linkage) : 'not_linked' });
      return aiRegisteredEntryActionObservationSchema.parse({ contractVersion: AI_REGISTERED_ENTRY_ACTION_VERSION,
        action: aiRegisteredEntryActionSchema.parse({ ...body, proof }), label: latest.label, observedAt: latest.observedAt,
        execution: 'not_attempted', authorization: 'recheck_current_original_resource' });
    };
    return Object.freeze({
      async issue(value: unknown, signal?: AbortSignal) {
        const command = aiRegisteredEntryActionIssueSchema.safeParse(structuredClone(value));
        if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        return sign(command.data.actionCode, command.data.targetId, command.data.source, signal);
      },
      async revalidate(value: unknown, signal?: AbortSignal) {
        const command = aiRegisteredEntryActionReadSchema.safeParse(structuredClone(value));
        if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const action = command.data.action;
        if (action.surface !== surface || action.audience !== audience || Date.parse(action.expiresAt) <= now().getTime()) throw denied();
        const { proof, ...body } = action;
        let sealed: Record<string, string>;
        try { sealed = d.secrets.decrypt(proof); } catch { throw denied(); }
        if (sealed.purpose !== 'rental-os:registered-entry-action:2' || sealed.bodyHash !== requestFingerprint(body)
          || sealed.publication !== configuration().fingerprint) throw denied();
        let decodedSource: unknown;
        try { decodedSource = JSON.parse(sealed.source ?? 'null'); } catch { throw denied(); }
        const origin = z.union([aiRegisteredEntryActionOrderSourceSchema, z.null()]).safeParse(decodedSource);
        if (!origin.success) throw denied();
        if (origin.data) {
          const binding = await linked(origin.data, signal);
          if (!await belongs(action.actionCode, action.resource.id, binding) || action.associations.taskId !== (binding.task?.taskId ?? null)
            || action.associations.runId !== (binding.task?.runId ?? null) || action.associations.orderId !== binding.orderId
            || linkedHash(binding) !== sealed.sourceHash) throw denied();
        } else if (action.associations.taskId !== null || action.associations.runId !== null) throw denied();
        const before = await readResource(action.actionCode, action.resource.id, signal);
        if (before.ownerKey !== sealed.ownerKey || action.bindingFingerprint !== before.ownerKey
          || requestFingerprint(before.resource) !== requestFingerprint(action.resource)
          || action.policyFingerprint !== requestFingerprint({ principal: originalIdentityHash(before.context),
            originalAuthority: before.authorityFingerprint ?? originalIdentityHash(before.context),
            clientPublication: before.clientPublication ?? null,
            resource: before.resource, publication: sealed.publication })
          || requestFingerprint(before.context.scope) !== requestFingerprint(action.scope)) throw denied();
        if (origin.data && linkedHash(await linked(origin.data, signal)) !== sealed.sourceHash) throw denied();
        const after = await readResource(action.actionCode, action.resource.id, signal); sameResource(before, after);
        if (sealed.publication !== configuration().fingerprint || Date.parse(action.expiresAt) <= now().getTime()) throw denied();
        check(signal);
        return aiRegisteredEntryActionRevalidationSchema.parse({ contractVersion: AI_REGISTERED_ENTRY_ACTION_VERSION,
          actionId: action.actionId, actionCode: action.actionCode, audience, surface, scope: action.scope,
          resource: action.resource, associations: action.associations, observedAt: now().toISOString(), state: 'revalidated',
          execution: 'not_attempted', navigation: 'fixed_destination_rechecks_authority' });
      },
      async fromOrder(value: unknown, signal?: AbortSignal) {
        const command = aiRegisteredEntryActionOrderSourceSchema.safeParse(structuredClone(value));
        if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const config = configuration(), initial = await linked(command.data, signal);
        const candidates: Array<{ code: AiEntryActionCode; id: string }> = [{ code: 'OPEN_ORDER', id: initial.orderId },
          ...(initial.targets.customer ? [{ code: audience === 'customer' ? 'OPEN_PROFILE' as const : 'OPEN_CUSTOMER' as const,
            id: initial.targets.customer.id }] : []),
          ...initial.targets.productIds.map(id => ({ code: 'OPEN_PRODUCT' as const, id })),
          ...(audience === 'customer' ? initial.paymentIds.map(id => ({ code: 'OPEN_PAYMENT' as const, id }))
            : [{ code: 'OPEN_DISPATCH' as const, id: initial.orderId }])];
        const routes = new AiBusinessReadRouteAuthority(d.guard, credentials, clock);
        if (audience === 'operations') try {
          const payments = await routes.withRead('payment_intents', { orderId: initial.orderId }, async context => {
            if (originalIdentityHash(context) !== originalIdentityHash(initial.targets.context) || context.scope.kind !== 'workspace') throw denied();
            return d.db.rentalPaymentIntent.findMany({ where: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
              orderId: initial.orderId }, orderBy: { id: 'asc' }, take: 20, select: { id: true } });
          });
          candidates.push(...payments.map(row => ({ code: 'OPEN_PAYMENT' as const, id: row.id })));
        } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || !['FORBIDDEN', 'AI_ACCESS_DENIED'].includes(String(error.code))) throw error;
        }
        if (candidates.length > 44) throw unavailable();
        const actions: AiRegisteredEntryActionObservation[] = [];
        for (const target of candidates) {
          try { actions.push(await sign(target.code, target.id, initial.source, signal)); }
          catch (error) {
            // A source order never grants a destination permission. Omit only
            // an explicitly denied target, then recheck the source below.
            if (!(error instanceof AiTaskRepositoryError) || error.code !== 'AI_ACCESS_DENIED') throw error;
          }
        }
        const closing = await linked(initial.source, signal);
        if (linkedHash(initial) !== linkedHash(closing) || config.fingerprint !== configuration().fingerprint) throw stale();
        // Every label has its own authority. A valid parent order cannot keep
        // a member/catalog/finance result visible after that target is revoked.
        const finalTargets = await Promise.all(actions.map(row => readResource(row.action.actionCode, row.action.resource.id, signal)));
        for (let index = 0; index < actions.length; index++) {
          const row = actions[index], observed = finalTargets[index];
          if (observed.ownerKey !== row.action.bindingFingerprint
            || requestFingerprint(observed.resource) !== requestFingerprint(row.action.resource)
            || requestFingerprint({ principal: originalIdentityHash(observed.context),
              originalAuthority: observed.authorityFingerprint ?? originalIdentityHash(observed.context),
              clientPublication: observed.clientPublication ?? null, resource: observed.resource,
              publication: config.fingerprint }) !== row.action.policyFingerprint
            || Date.parse(row.action.expiresAt) <= now().getTime()) throw denied();
        }
        if (linkedHash(await linked(initial.source, signal)) !== linkedHash(initial)
          || config.fingerprint !== configuration().fingerprint) throw stale();
        check(signal);
        const returnedAt = now();
        if (actions.some(row => Date.parse(row.action.expiresAt) <= returnedAt.getTime())) throw denied();
        return aiRegisteredEntryActionOrderResponseSchema.parse({ contractVersion: AI_REGISTERED_ENTRY_ACTION_VERSION,
          source: initial.source, orderId: initial.orderId, scope: initial.scope, observedAt: returnedAt.toISOString(),
          actions, execution: 'not_attempted', businessApproval: 'not_granted' });
      },
      close() { active = false; },
    });
  };
}
