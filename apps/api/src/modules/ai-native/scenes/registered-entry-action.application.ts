/** Fixed original-resource Actions. Navigation only observes original resources;
 * notification preparation explicitly saves an unsent original-domain draft.
 * Current Guard/ALS, material and publication are rechecked before every new
 * effect. No model, business sending or provider refresh is invoked here. */
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
  AI_ENTRY_NOTIFICATION_DRAFT_VERSION, aiEntryNotificationDraftPrepareSchema, aiEntryNotificationDraftSaveSchema,
  aiEntryNotificationDraftReadSchema, aiEntryNotificationDraftMaterialSchema, aiEntryNotificationDraftResponseSchema,
  type AiEntryNotificationDraftMaterial, type AiEntryNotificationDraftResponse,
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
import { EntryNotificationDraftService, type EntryNotificationDraftDependencies } from './entry-notification-draft.service';
import { EntryNotificationDraftError } from './entry-notification-draft.contract';
import { recordEntryActionObservation, recordOriginalNotificationDraftSaved, type EntryActionAuditEvent } from './entry-action.audit';
import { hasEffectivePermission } from '../../../common/permission-match';

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
  secrets: Pick<SecretBox, 'encrypt' | 'decrypt'> & Partial<Pick<SecretBox, 'fingerprint'>>;
  publication: Pick<ConfigService, 'get'>;
  core: Pick<RentalCoreService, 'readOrderFacts' | 'listItemGroupsPage'>;
  client: Pick<ClientApiService, 'getOrder' | 'readOwnProfileNavigation' | 'readClientProductNavigation' | 'readOwnPaymentNavigation' | 'readOwnOrderNavigationSources'>;
  orderHandoff: Pick<ReturnType<typeof composeRequestBoundTaskOrderHandoff>, 'read'>;
  /** Optional only for compatibility with navigation-only hosts. Missing
   * original draft ports never produce a save Action or fallback success. */
  notificationDraft?: Pick<EntryNotificationDraftDependencies, 'customers' | 'core' | 'business'>;
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
    const notificationPrincipal = async (signal?: AbortSignal) => {
      check(signal);
      let originalTenant: NonNullable<Awaited<ReturnType<AuthService['resolveAccessContext']>>>['tenantUser'] | undefined;
      const authority = new AiTaskCurrentIdentityAuthority({ resolveAccessContext: async (...args) => {
        const current = await d.auth.resolveAccessContext(...args); check(signal);
        originalTenant = current && structuredClone(current.tenantUser);
        return current;
      } }, credentials, clock);
      const context = await authority.resolve(); check(signal);
      if (audience !== 'operations' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
        || !originalTenant?.isActive || originalTenant.isSaasAdmin || originalTenant.id !== context.actor.userId
        || originalTenant.tenantId !== context.scope.tenantId || !Array.isArray(originalTenant.permissions)
        || !(originalTenant.isPlatformAdmin || originalTenant.dataScope === 'all'
          && (hasEffectivePermission(originalTenant.permissions, 'rental-os:member:view')
            || hasEffectivePermission(originalTenant.permissions, 'rental-os:member:manage'))
          && hasEffectivePermission(originalTenant.permissions, 'rental-os:customer:reveal-sensitive')))
        throw denied();
      return { context, ownerKey: originalIdentityHash(context), identity: undefined };
    };
    const notificationOwner = (context: AiExecutionContext) => {
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || audience !== 'operations') throw denied();
      return requestFingerprint({ version: AI_ENTRY_NOTIFICATION_DRAFT_VERSION, actorId: context.actor.userId,
        tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId });
    };
    const notificationResource = (material: AiEntryNotificationDraftMaterial): AiRegisteredEntryAction['resource'] => ({
      kind: 'notification_draft', id: material.id, resourceVersion: requestFingerprint({ version: material.version,
        id: material.id, key: material.key, inputHash: material.inputHash, contentHash: material.contentHash,
        templateHash: material.templateHash, configurationHash: material.configurationHash, customerVersion: material.customerVersion }),
    });
    const notificationHost = async (signal?: AbortSignal, expected?: { principal: string; publication: string; expiresAt: string;
      draftId: string; key: string; commandHash: string }) => {
      if (audience !== 'operations' || !d.notificationDraft || typeof d.secrets.fingerprint !== 'function') throw unavailable();
      const initial = await notificationPrincipal(signal), originalPrincipal = originalIdentityHash(initial.context);
      notificationOwner(initial.context);
      let publication: ReturnType<typeof configuration> | undefined;
      const leaf = new EntryNotificationDraftService({ ...d.notificationDraft, guard: d.guard, credentials,
        secrets: { fingerprint: d.secrets.fingerprint.bind(d.secrets) }, clock,
        revalidate: async (mode, _signal, tx) => {
          try {
            check(signal);
            const current = await notificationPrincipal(signal);
            if (originalIdentityHash(current.context) !== originalPrincipal) throw denied();
            // Receipt reads keep current original read authority and are not new
            // generation. A stopped/expired save publication cannot erase them.
            if (mode !== 'read') {
              const currentPublication = configuration();
              if (publication && publication.fingerprint !== currentPublication.fingerprint) throw stale();
              if (expected && (expected.principal !== originalPrincipal || expected.publication !== currentPublication.fingerprint
                || Date.parse(expected.expiresAt) <= now().getTime())) throw denied();
              publication = currentPublication;
              if (mode === 'save' && tx && expected) {
                const saved = await tx.rentalNotificationLog.findFirst({ where: { id: expected.draftId,
                  tenantId: current.context.scope.kind === 'workspace' ? current.context.scope.tenantId : '',
                  workspaceId: current.context.scope.kind === 'workspace' ? current.context.scope.workspaceId : '', idempotencyKey: expected.key } });
                if (saved) {
                  const metadata = saved.variables && typeof saved.variables === 'object' && !Array.isArray(saved.variables)
                    ? saved.variables.notificationDraft : null;
                  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || saved.status !== 'draft'
                    || saved.provider !== 'not_dispatched' || saved.attempts !== 0 || saved.maxAttempts !== 0
                    || metadata.actorId !== (current.context.actor.kind === 'user' ? current.context.actor.userId : null)
                    || metadata.commandHash !== expected.commandHash || typeof metadata.inputHash !== 'string'
                    || typeof metadata.contentHash !== 'string') throw unavailable();
                  await recordOriginalNotificationDraftSaved(tx, current.context, { draftId: saved.id, key: expected.key,
                    commandHash: expected.commandHash, inputHash: metadata.inputHash, contentHash: metadata.contentHash });
                  const after = await notificationPrincipal(signal);
                  if (originalIdentityHash(after.context) !== originalPrincipal || configuration().fingerprint !== currentPublication.fingerprint
                    || Date.parse(expected.expiresAt) <= now().getTime()) throw denied();
                }
              }
            }
            check(signal);
          } catch (error) {
            // Preserve known pre-save refusals. The original domain separately
            // converts failures after a possible INSERT into unknown.
            if (error instanceof AiTaskRepositoryError && ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT'].includes(error.code))
              throw new EntryNotificationDraftError(error.code as 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT');
            throw error;
          }
        },
        reviewExpiresAt: observedAt => {
          const current = configuration();
          if (!publication || current.fingerprint !== publication.fingerprint) throw stale();
          return new Date(Math.min(observedAt.getTime() + current.ttlMs, Date.parse(current.expiresAt)));
        },
      });
      return { initial, originalPrincipal, leaf, publication: () => publication };
    };
    const publicNotificationResponse = (value: unknown, mayHaveSaved: boolean): AiEntryNotificationDraftResponse => {
      const parsed = aiEntryNotificationDraftResponseSchema.safeParse(value);
      if (!parsed.success) throw new EntryNotificationDraftError(mayHaveSaved ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE');
      return parsed.data;
    };
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
        || !(NAVIGATION_CODES as readonly string[]).includes(code) && code !== 'CREATE_NOTIFICATION_DRAFT') throw unavailable();
      let found: Observation;
      if (code === 'CREATE_NOTIFICATION_DRAFT') {
        const host = await notificationHost(signal);
        const draft = aiEntryNotificationDraftMaterialSchema.parse(await host.leaf.readResource({ draftId: targetId }, signal));
        if (before.context.scope.kind !== 'workspace' || draft.scope.tenantId !== before.context.scope.tenantId
          || draft.scope.workspaceId !== before.context.scope.workspaceId || before.context.actor.kind !== 'user'
          || draft.actorId !== before.context.actor.userId || host.originalPrincipal !== originalIdentityHash(before.context)) throw denied();
        found = { context: before.context, ownerKey: notificationOwner(before.context), resource: notificationResource(draft),
          label: draft.renderedTitle || draft.templateId, observedAt: now().toISOString() };
      } else if (audience === 'customer') {
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
    const methods = {
      async issue(value: unknown, signal?: AbortSignal) {
        const command = aiRegisteredEntryActionIssueSchema.safeParse(structuredClone(value));
        if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        if (command.data.actionCode === 'CREATE_NOTIFICATION_DRAFT') throw unavailable();
        return sign(command.data.actionCode, command.data.targetId, command.data.source, signal);
      },
      async prepareNotificationDraft(value: unknown, signal?: AbortSignal) {
        const parsed = aiEntryNotificationDraftPrepareSchema.safeParse(structuredClone(value));
        if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 32768) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const command = parsed.data, host = await notificationHost(signal), result = await host.leaf.prepare(command, signal);
        if (result.state !== 'prepared') return publicNotificationResponse({ ...result, action: null }, false);
        const material = aiEntryNotificationDraftMaterialSchema.parse(result.material), config = host.publication();
        const closing = await notificationPrincipal(signal), time = now();
        if (!config || config.fingerprint !== configuration().fingerprint || host.originalPrincipal !== originalIdentityHash(closing.context)
          || closing.context.scope.kind !== 'workspace' || closing.context.actor.kind !== 'user'
          || material.actorId !== closing.context.actor.userId || material.scope.tenantId !== closing.context.scope.tenantId
          || material.scope.workspaceId !== closing.context.scope.workspaceId || Date.parse(result.expiresAt) <= time.getTime()) throw denied();
        const resource = notificationResource(material), ownerKey = notificationOwner(closing.context);
        const body = { contractVersion: AI_REGISTERED_ENTRY_ACTION_VERSION, actionId: randomUUID(),
          actionCode: 'CREATE_NOTIFICATION_DRAFT' as const, audience: 'operations' as const, surface: 'tenant_admin' as const,
          scope: closing.context.scope, resource, requiresConfirmation: true, riskLevel: 'R1' as const,
          issuedAt: result.observedAt, expiresAt: result.expiresAt, inputFingerprint: material.inputHash, bindingFingerprint: ownerKey,
          policyFingerprint: requestFingerprint({ principal: host.originalPrincipal, originalAuthority: host.originalPrincipal,
            clientPublication: null, resource, publication: config.fingerprint }),
          associations: { materialRef: null, taskId: null, runId: null, proposalId: null, quoteId: null, bookingDraftId: null, orderId: null } };
        const proof = d.secrets.encrypt({ purpose: 'rental-os:registered-entry-action:2', ownerKey, publication: config.fingerprint,
          bodyHash: requestFingerprint(body), source: 'null', sourceHash: 'not_linked',
          notificationPrincipal: host.originalPrincipal, notificationOperationKey: command.operationKey,
          notificationReviewHash: result.reviewHash, notificationCommandHash: material.commandHash,
          notificationInputHash: material.inputHash, notificationContentHash: material.contentHash });
        check(signal);
        return publicNotificationResponse({ ...result, action: aiRegisteredEntryActionSchema.parse({ ...body, proof }) }, false);
      },
      async saveNotificationDraft(value: unknown, signal?: AbortSignal) {
        const parsed = aiEntryNotificationDraftSaveSchema.safeParse(structuredClone(value));
        if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 65536) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const { action, command } = parsed.data, { proof, ...body } = action;
        let sealed: Record<string, string>;
        try { sealed = d.secrets.decrypt(proof); } catch { throw denied(); }
        const host = await notificationHost(signal, { principal: sealed.notificationPrincipal,
          publication: sealed.publication, expiresAt: action.expiresAt, draftId: action.resource.id,
          key: action.resource.id.slice('notification-draft-'.length), commandHash: sealed.notificationCommandHash });
        const context = host.initial.context;
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || typeof d.secrets.fingerprint !== 'function') throw denied();
        const originalKey = requestFingerprint({ version: AI_ENTRY_NOTIFICATION_DRAFT_VERSION, actorId: context.actor.userId,
          tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, operationKey: command.operationKey });
        const input = { customerId: command.customerId, templateId: command.templateId,
          templateVersion: command.templateVersion, variables: command.variables };
        if (sealed.purpose !== 'rental-os:registered-entry-action:2' || sealed.bodyHash !== requestFingerprint(body)
          || sealed.ownerKey !== notificationOwner(context) || action.bindingFingerprint !== sealed.ownerKey
          || sealed.source !== 'null' || sealed.sourceHash !== 'not_linked' || Object.values(action.associations).some(value => value !== null)
          || action.resource.id !== `notification-draft-${originalKey}` || action.scope.tenantId !== context.scope.tenantId
          || action.scope.workspaceId !== context.scope.workspaceId || sealed.notificationOperationKey !== command.operationKey
          || sealed.notificationReviewHash !== command.reviewHash || action.expiresAt !== command.expiresAt
          || action.inputFingerprint !== sealed.notificationInputHash
          || sealed.notificationCommandHash !== d.secrets.fingerprint(requestFingerprint({ version: 'rental-notification-draft-1', input }))) throw denied();
        // The leaf checks an exact original receipt before requesting save
        // authority. Expired/disabled generation never authorizes a fresh save.
        try {
          const result = await host.leaf.save(command, signal);
          return publicNotificationResponse({ ...result, action: null }, true);
        } catch (error) {
          if (error instanceof EntryNotificationDraftError) throw error;
          throw new EntryNotificationDraftError('AI_RESULT_UNKNOWN');
        }
      },
      async readNotificationDraft(value: unknown, signal?: AbortSignal) {
        const parsed = aiEntryNotificationDraftReadSchema.safeParse(structuredClone(value));
        if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const host = await notificationHost(signal), result = await host.leaf.read(parsed.data, signal);
        return publicNotificationResponse({ ...result, action: null }, false);
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
    };
    const audited = <N extends keyof typeof methods>(name: N) => async (value: unknown, signal?: AbortSignal) => {
      let frozen: unknown;
      try { frozen = structuredClone(value); if (Buffer.byteLength(JSON.stringify(frozen) ?? '', 'utf8') > 131072) throw Error(); }
      catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
      const started = now().getTime(), actor = await principal(signal);
      let savedObserved = false;
      let observationAttempted = false;
      const event: EntryActionAuditEvent = { requestId, surface, contractVersion: name.includes('Notification')
        ? AI_ENTRY_NOTIFICATION_DRAFT_VERSION : AI_REGISTERED_ENTRY_ACTION_VERSION, operation: name,
        state: 'observed', durationMs: 0 };
      const originalAction = name === 'revalidate' ? aiRegisteredEntryActionReadSchema.safeParse(frozen)
        : name === 'saveNotificationDraft' ? aiEntryNotificationDraftSaveSchema.safeParse(frozen) : undefined;
      if (originalAction?.success) {
        const { proof, ...body } = originalAction.data.action;
        try {
          const sealed = d.secrets.decrypt(proof);
          const ownerKey = body.actionCode === 'CREATE_NOTIFICATION_DRAFT' ? notificationOwner(actor.context) : actor.ownerKey;
          // An expired Action can still identify its original refusal. Only its
          // authenticated seal and the current principal supply that association.
          if (sealed.purpose === 'rental-os:registered-entry-action:2' && sealed.bodyHash === requestFingerprint(body)
            && sealed.ownerKey === ownerKey && body.bindingFingerprint === ownerKey
            && body.surface === surface && body.audience === audience
            && requestFingerprint(body.scope) === requestFingerprint(actor.context.scope)) {
            event.actionId = body.actionId; event.actionCode = body.actionCode; event.resourceId = body.resource.id;
          }
        } catch { /* An unverifiable submitted Action supplies no audit association. */ }
      }
      // A lost save response still needs its original locator in the audit.
      // This is scoped request correlation, never evidence of a saved draft or
      // a valid Action; only the original operation/receipt supplies that fact.
      const notificationKey = (() => {
        if (name === 'prepareNotificationDraft') {
          const input = aiEntryNotificationDraftPrepareSchema.safeParse(frozen);
          return input.success ? input.data.operationKey : undefined;
        }
        if (name === 'saveNotificationDraft') {
          const input = aiEntryNotificationDraftSaveSchema.safeParse(frozen);
          return input.success ? input.data.command.operationKey : undefined;
        }
        if (name === 'readNotificationDraft') {
          const input = aiEntryNotificationDraftReadSchema.safeParse(frozen);
          return input.success ? input.data.operationKey : undefined;
        }
        return undefined;
      })();
      if (notificationKey && actor.context.actor.kind === 'user' && actor.context.scope.kind === 'workspace') {
        event.operationKeyHash = requestFingerprint({ version: AI_ENTRY_NOTIFICATION_DRAFT_VERSION,
          actorId: actor.context.actor.userId, tenantId: actor.context.scope.tenantId,
          workspaceId: actor.context.scope.workspaceId, operationKey: notificationKey });
      }
      try {
        const result = await methods[name](frozen, signal);
        savedObserved = name === 'saveNotificationDraft' && 'state' in result && result.state === 'saved';
        if ('action' in result && result.action) { event.actionId = result.action.actionId;
          event.actionCode = result.action.actionCode; event.resourceId = result.action.resource.id; }
        if ('actionId' in result) { event.actionId = result.actionId; event.actionCode = result.actionCode; event.resourceId = result.resource.id; }
        if ('operationKey' in result && actor.context.actor.kind === 'user' && actor.context.scope.kind === 'workspace')
          event.operationKeyHash = requestFingerprint({ version: AI_ENTRY_NOTIFICATION_DRAFT_VERSION,
            actorId: actor.context.actor.userId, tenantId: actor.context.scope.tenantId,
            workspaceId: actor.context.scope.workspaceId, operationKey: result.operationKey });
        if ('material' in result) { event.draftId = result.material.id; event.resultState = result.state; }
        if ('draft' in result && result.draft) { event.draftId = result.draft.id; event.resultState = result.state; }
        if ('state' in result && result.state === 'unknown') { event.state = 'unknown'; event.resultState = 'unknown'; }
        if ('actions' in result) event.actions = result.actions.map(row => ({ actionId: row.action.actionId,
          actionCode: row.action.actionCode, resourceId: row.action.resource.id }));
        if ('source' in result && 'taskId' in result.source) { event.taskId = result.source.taskId; event.runId = result.source.runId; }
        event.durationMs = Math.max(0, now().getTime() - started);
        // A lost log acknowledgement cannot authorize another append when the
        // same operation or delivery failure reaches the outer error boundary.
        observationAttempted = true;
        try { await recordEntryActionObservation(d.db, actor.context, event); }
        catch { throw new EntryNotificationDraftError(name === 'saveNotificationDraft' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE'); }
        // The audit is another awaited dependency. It cannot keep old authority,
        // resources or an expired Action alive while the response is delivered.
        if ('actions' in result) for (const row of result.actions) await methods.revalidate({ action: row.action }, signal);
        else if ('action' in result && result.action && !name.includes('Notification')) await methods.revalidate({ action: result.action }, signal);
        else if (name === 'revalidate') await methods.revalidate(frozen, signal);
        if ('material' in result) {
          const host = await notificationHost(signal), current = await host.leaf.prepare(frozen, signal);
          if (current.state !== 'prepared' || requestFingerprint(current.material) !== requestFingerprint(result.material)) throw stale();
        } else if ('draft' in result) {
          const host = await notificationHost(signal), current = await host.leaf.read({ operationKey: result.operationKey }, signal);
          if (current.state !== result.state || ('draft' in current && requestFingerprint(current.draft) !== requestFingerprint(result.draft))) throw stale();
        }
        const closing = name.includes('Notification') ? await notificationPrincipal(signal) : await principal(signal);
        if (originalIdentityHash(closing.context) !== originalIdentityHash(actor.context)) throw denied();
        const deliveredAt = now().getTime();
        if ('actions' in result && result.actions.some(row => Date.parse(row.action.expiresAt) <= deliveredAt)) throw denied();
        if ('action' in result && result.action && (Date.parse(result.action.expiresAt) <= deliveredAt
          || (() => { try { return d.secrets.decrypt(result.action!.proof).publication !== configuration().fingerprint; } catch { return true; } })())) throw denied();
        check(signal);
        return result;
      } catch (error) {
        const rawCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'AI_RESOURCE_UNAVAILABLE';
        const code = savedObserved && !['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(rawCode) ? 'AI_RESULT_UNKNOWN' : rawCode;
        event.state = code === 'AI_RESULT_UNKNOWN' ? 'unknown' : 'refused'; event.refusalCode = code;
        if (code === 'AI_RESULT_UNKNOWN' && notificationKey) event.resultState = 'unknown';
        event.durationMs = Math.max(0, now().getTime() - started);
        if (!observationAttempted) {
          observationAttempted = true;
          try { await recordEntryActionObservation(d.db, actor.context, event); }
          catch { throw new EntryNotificationDraftError(name === 'saveNotificationDraft' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE'); }
        }
        if (code !== rawCode) throw new EntryNotificationDraftError('AI_RESULT_UNKNOWN');
        throw error;
      }
    };
    return Object.freeze({ issue: audited('issue'), revalidate: audited('revalidate'), fromOrder: audited('fromOrder'),
      prepareNotificationDraft: audited('prepareNotificationDraft'), saveNotificationDraft: audited('saveNotificationDraft'),
      readNotificationDraft: audited('readNotificationDraft'), close() { active = false; } });
  };
}
