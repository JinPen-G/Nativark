/** Request-bound R1 preparation/save and exact original notification receipts.
 * Reuses the original notification and customer Guard/ALS routes. The outer
 * application revalidates its registered Action; this leaf never signs one,
 * sends a message, refreshes a provider or retries an uncertain write. */
import { HttpException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { Prisma } from '@prisma/client';
import type { SystemUserRow } from '@rental-os/shared';
import type { ApiAuthGuard } from '../rental-adapters/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '@rental-os/platform-server/request-identity';
import type { SecretBox } from '@rental-os/platform-server/secret-box';
import type { PlatformService } from '../rental-adapters/platform.service';
import type { RentalCoreService } from '../rental-adapters/rental-core.service';
import type { RentalBusinessService, RentalNotificationDraftInput, RentalNotificationDraftObservation,
  RentalNotificationDraftOriginal } from '../rental-adapters/rental-business.service';
import { RentalNotificationDraftUnknownError } from '../rental-adapters/rental-business.service';
import { canManageWorkspaceWideNotifications } from '@rental-os/rental-core/workbench';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { callAiTaskRunnerDependency, AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { ENTRY_NOTIFICATION_DRAFT_VERSION, EntryNotificationDraftError, entryNotificationDraftPrepareSchema,
  entryNotificationDraftSaveSchema, entryNotificationDraftReadSchema, entryNotificationDraftResourceSchema, parseEntryNotificationDraft,
  type EntryNotificationDraftCredentials, type EntryNotificationDraftResponse } from './entry-notification-draft.contract';

export type EntryNotificationDraftPurpose = 'prepare' | 'save' | 'read';
type Purpose = EntryNotificationDraftPurpose;
type Actor = { tenantId: string; workspaceId: string; actorId: string; fingerprint: string };
export interface EntryNotificationDraftDependencies {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: EntryNotificationDraftCredentials;
  customers: Pick<PlatformService, 'getCustomerDetail'>;
  core: Pick<RentalCoreService, 'readBusinessContext'>;
  business: Pick<RentalBusinessService, 'refreshWorkspaceContext' | 'previewNotificationDraft'
    | 'prepareNotificationDraft' | 'readNotificationDraft'>;
  secrets: Pick<SecretBox, 'fingerprint'>;
  /** Required server-owned registered-Action/source barrier. No default grant;
   * the application supplies its same bound identity and publication checks. */
  revalidate(purpose: Purpose, signal?: AbortSignal, tx?: Prisma.TransactionClient): Promise<void>;
  /** Current publication may shorten the original review window, never extend it. */
  reviewExpiresAt?(observedAt: Date): Date;
  clock?(): Date;
}

const denied = () => new EntryNotificationDraftError('AI_ACCESS_DENIED');
const unavailable = () => new EntryNotificationDraftError('AI_RESOURCE_UNAVAILABLE');
const stale = () => new EntryNotificationDraftError('AI_REVISION_CONFLICT');
const unknown = () => new EntryNotificationDraftError('AI_RESULT_UNKNOWN');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);

export class EntryNotificationDraftService {
  private readonly clock: () => Date;
  private readonly d: EntryNotificationDraftDependencies;
  constructor(d: EntryNotificationDraftDependencies) {
    if (!d || typeof d.guard?.canActivate !== 'function' || typeof d.credentials?.current !== 'function'
      || typeof d.customers?.getCustomerDetail !== 'function' || typeof d.core?.readBusinessContext !== 'function'
      || typeof d.business?.refreshWorkspaceContext !== 'function' || typeof d.business?.previewNotificationDraft !== 'function'
      || typeof d.business?.prepareNotificationDraft !== 'function' || typeof d.business?.readNotificationDraft !== 'function'
      || typeof d.secrets?.fingerprint !== 'function' || typeof d.revalidate !== 'function') throw unavailable();
    this.clock = d.clock ?? (() => new Date());
    this.d = Object.freeze({ ...d, guard: { canActivate: d.guard.canActivate.bind(d.guard) },
      credentials: { current: d.credentials.current.bind(d.credentials) },
      customers: { getCustomerDetail: d.customers.getCustomerDetail.bind(d.customers) },
      core: { readBusinessContext: d.core.readBusinessContext.bind(d.core) },
      business: { refreshWorkspaceContext: d.business.refreshWorkspaceContext.bind(d.business),
        previewNotificationDraft: d.business.previewNotificationDraft.bind(d.business),
        prepareNotificationDraft: d.business.prepareNotificationDraft.bind(d.business),
        readNotificationDraft: d.business.readNotificationDraft.bind(d.business) },
      secrets: { fingerprint: d.secrets.fingerprint.bind(d.secrets) }, revalidate: d.revalidate.bind(d) });
  }

  private at() {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable();
    return new Date(value.getTime());
  }

  private async run<T>(purpose: Purpose, work: (context: {
    actor: Actor; original(operationKey: string): RentalNotificationDraftOriginal;
    revalidate(purpose?: Purpose, tx?: Prisma.TransactionClient): Promise<void>;
    customer(customerId: string): Promise<void>;
    businessContext(): Promise<Awaited<ReturnType<RentalCoreService['readBusinessContext']>>>;
    check(): void;
  }) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let active = !signal?.aborted, entered = false;
    const close = () => { active = false; }, check = () => { if (!active || signal?.aborted) throw denied(); };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await callAiTaskRunnerDependency(async () => {
        check();
        const credential = structuredClone(await this.d.credentials.current()); check();
        if (credential.audience !== 'operator' || typeof credential.authorization !== 'string'
          || credential.authorization.length > 8192 || !/^Bearer \S+$/u.test(credential.authorization)
          || typeof credential.requestId !== 'string' || !credential.requestId) throw denied();
        const guard = this.d.guard.canActivate.bind(this.d.guard), boundCredential = Object.freeze(credential);
        const authorize = async (path: string, consume: (user: SystemUserRow, actor: Actor) => Promise<void>, expected?: Actor,
          expectedRoute?: string, after?: () => Promise<void>) => {
          check(); if (!same(await this.d.credentials.current(), boundCredential)) throw denied(); check();
          return runWithRequestIdentity({}, async () => {
            const request = { method: 'GET', url: `/api${path}`, originalUrl: `/api${path}`,
              headers: { authorization: boundCredential.authorization }, query: {}, body: {}, user: undefined as SystemUserRow | undefined };
            if (await guard(new ExecutionContextHost([request])) !== true) throw denied(); check();
            const user = request.user, identity = structuredClone(getRequestIdentity());
            const tenantRead = path.startsWith('/platform/customers/');
            if (!user?.isActive || user.isSaasAdmin || identity?.isSaasAdmin || identity?.staffApi
              || identity?.audience !== 'operator' || identity?.userId !== user.id || identity?.tenantId !== user.tenantId
              || !identity.workspaceId || (tenantRead
                ? !(user.isPlatformAdmin || hasEffectivePermission(user.permissions ?? [], 'rental-os:customer:reveal-sensitive'))
                  || !(user.isPlatformAdmin || hasEffectivePermission(user.permissions ?? [], 'rental-os:member:view')
                    || hasEffectivePermission(user.permissions ?? [], 'rental-os:member:manage')) || !user.isPlatformAdmin && identity.dataScope !== 'all'
                : !(user.isPlatformAdmin || hasEffectivePermission(user.permissions ?? [], 'system:integration:manage'))
                  || !canManageWorkspaceWideNotifications(identity.dataScope,
                    identity.locationScope?.mode === 'selected' ? identity.locationScope.locationIds : identity.locationScope?.mode === 'all' ? undefined : []))) throw denied();
            const routeHash = requestFingerprint({ identity, permissions: user.permissions, isPlatformAdmin: user.isPlatformAdmin ?? false });
            if (expectedRoute && expectedRoute !== routeHash) throw denied();
            const actor: Actor = { tenantId: user.tenantId, workspaceId: identity.workspaceId, actorId: user.id,
              fingerprint: routeHash };
            if (expected && (actor.tenantId !== expected.tenantId || actor.workspaceId !== expected.workspaceId
              || actor.actorId !== expected.actorId || !tenantRead && actor.fingerprint !== expected.fingerprint)) throw denied();
            await consume(user, actor); check();
            if (!same(await this.d.credentials.current(), boundCredential) || !same(identity, getRequestIdentity())) throw denied(); check();
            if (after) await after();
            return actor;
          });
        };
        let result!: T;
        await authorize('/rental/v1/notification-templates', async (_user, actor) => {
          const revalidate = async (mode: Purpose = 'read', tx?: Prisma.TransactionClient) => {
            check(); await this.d.revalidate(mode, signal, tx); check();
            await authorize('/rental/v1/notification-templates', async () => undefined, actor); check();
          };
          const customer = async (customerId: string) => {
            const path = `/platform/customers/${encodeURIComponent(customerId)}`;
            let customerAuthority = '';
            await authorize(path, async (user, originalActor) => {
              customerAuthority = originalActor.fingerprint;
              const original = structuredClone(await this.d.customers.getCustomerDetail(customerId, user)); check();
              if (original.id !== customerId || original.tenantId !== actor.tenantId) throw denied();
            }, actor, undefined, async () => { await authorize(path, async () => undefined, actor, customerAuthority); });
            check();
          };
          const businessContext = async () => {
            check();
            const context = structuredClone(await this.d.core.readBusinessContext(actor.tenantId)); check();
            await this.d.business.refreshWorkspaceContext(actor.tenantId, context); check();
            await revalidate(); return context;
          };
          await revalidate(); entered = true;
          result = await work({ actor, original: operationKey => ({ actorId: actor.actorId,
            key: requestFingerprint({ version: ENTRY_NOTIFICATION_DRAFT_VERSION, actorId: actor.actorId,
              tenantId: actor.tenantId, workspaceId: actor.workspaceId, operationKey }) }), revalidate, customer, businessContext, check });
          await revalidate(); check();
        });
        return result;
      }, 15000, 'notification_draft', signal);
    } catch (error) {
      if (error instanceof EntryNotificationDraftError) throw error;
      if (error instanceof RentalNotificationDraftUnknownError) throw unknown();
      if (error instanceof AiTaskRunnerError && ['AI_RESULT_UNKNOWN', 'AI_RUN_LIMIT'].includes(error.code)) {
        throw purpose === 'save' && entered ? unknown() : unavailable();
      }
      if (error instanceof HttpException) {
        if ([401, 403, 404].includes(error.getStatus())) throw denied();
        if (error.getStatus() === 400) throw new EntryNotificationDraftError('AI_INVALID_INPUT');
        if (error.getStatus() === 409) throw stale();
      }
      throw purpose === 'save' && entered ? unknown() : unavailable();
    } finally { active = false; signal?.removeEventListener('abort', close); }
  }

  private observed(operationKey: string, actor: Actor, draft: RentalNotificationDraftObservation | null): EntryNotificationDraftResponse {
    return { contractVersion: ENTRY_NOTIFICATION_DRAFT_VERSION, operationKey,
      scope: { kind: 'workspace', tenantId: actor.tenantId, workspaceId: actor.workspaceId }, observedAt: this.at().toISOString(),
      automaticRetry: false, dispatch: 'not_dispatched', nextAction: 'read_original_notification_draft',
      ...(draft ? { state: 'saved' as const, draft, persistence: 'draft_saved' as const, execution: 'not_sent' as const }
        : { state: 'unknown' as const, draft: null, persistence: 'not_attested' as const, execution: 'not_attested' as const }) };
  }

  private review(material: RentalNotificationDraftObservation, expiresAt: string) {
    return this.d.secrets.fingerprint(requestFingerprint({ version: ENTRY_NOTIFICATION_DRAFT_VERSION,
      key: material.key, actorId: material.actorId, scope: material.scope, inputHash: material.inputHash, expiresAt }));
  }

  private commandHash(input: RentalNotificationDraftInput) {
    return this.d.secrets.fingerprint(requestFingerprint({ version: 'rental-notification-draft-1', input }));
  }

  async prepare(value: unknown, signal?: AbortSignal) {
    const command = parseEntryNotificationDraft(entryNotificationDraftPrepareSchema, value);
    return this.run<EntryNotificationDraftResponse>('prepare', async context => {
      const original = context.original(command.operationKey), input: RentalNotificationDraftInput = { customerId: command.customerId,
        templateId: command.templateId, templateVersion: command.templateVersion, variables: command.variables };
      const existing = await this.d.business.readNotificationDraft(context.actor.tenantId, original, this.commandHash(input));
      context.check();
      if (existing) { await context.customer(existing.customerId); return this.observed(command.operationKey, context.actor, existing); }
      await context.customer(command.customerId);
      await context.revalidate('prepare');
      const material = await this.d.business.previewNotificationDraft(context.actor.tenantId, await context.businessContext(),
        input, original); context.check();
      if (material.status === 'draft') return this.observed(command.operationKey, context.actor, material);
      await context.customer(command.customerId);
      await context.revalidate('prepare');
      const observedAt = this.at(), expiry = this.d.reviewExpiresAt?.(new Date(observedAt.getTime()))
        ?? new Date(observedAt.getTime() + 120000);
      if (!(expiry instanceof Date) || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= observedAt.getTime()
        || expiry.getTime() > observedAt.getTime() + 120000) throw unavailable();
      const expiresAt = expiry.toISOString();
      return { contractVersion: ENTRY_NOTIFICATION_DRAFT_VERSION, operationKey: command.operationKey,
        scope: { kind: 'workspace', tenantId: context.actor.tenantId, workspaceId: context.actor.workspaceId }, observedAt: observedAt.toISOString(),
        automaticRetry: false, dispatch: 'not_dispatched', state: 'prepared', material, reviewHash: this.review(material, expiresAt), expiresAt,
        persistence: 'not_saved', execution: 'not_attempted', nextAction: 'explicit_save_or_original_notification_page' };
    }, signal);
  }

  async save(value: unknown, signal?: AbortSignal) {
    const command = parseEntryNotificationDraft(entryNotificationDraftSaveSchema, value);
    return this.run('save', async context => {
      const original = context.original(command.operationKey), input: RentalNotificationDraftInput = { customerId: command.customerId,
        templateId: command.templateId, templateVersion: command.templateVersion, variables: command.variables };
      // Exact receipt lookup precedes today's template availability. The same
      // client intent can observe an old draft, never replace it with a new one.
      const old = await this.d.business.readNotificationDraft(context.actor.tenantId, original, this.commandHash(input)); context.check();
      if (old) { await context.customer(old.customerId); return this.observed(command.operationKey, context.actor, old); }
      await context.customer(command.customerId);
      await context.revalidate('save');
      const businessContext = await context.businessContext();
      const material = await this.d.business.previewNotificationDraft(context.actor.tenantId, businessContext, input, original); context.check();
      if (material.status === 'draft') return this.observed(command.operationKey, context.actor, material);
      if (Date.parse(command.expiresAt) <= this.at().getTime() || Date.parse(command.expiresAt) > this.at().getTime() + 120000
        || this.review(material, command.expiresAt) !== command.reviewHash) throw stale();
      const draft = await this.d.business.prepareNotificationDraft(context.actor.tenantId, businessContext, input, original,
        { inputHash: material.inputHash, expiresAt: command.expiresAt }, async tx => {
          await context.revalidate('save', tx);
          await context.customer(command.customerId);
          const latest = await context.businessContext();
          if (!same(latest.settings.notifications, businessContext.settings.notifications)
            || latest.categoryVersionId !== businessContext.categoryVersionId
            || latest.categoryAdoptionRevision !== businessContext.categoryAdoptionRevision) throw stale();
          await context.customer(command.customerId);
          await context.revalidate('save', tx);
          context.check();
        });
      context.check(); await context.customer(draft.customerId);
      return this.observed(command.operationKey, context.actor, draft);
    }, signal);
  }

  async read(value: unknown, signal?: AbortSignal) {
    const command = parseEntryNotificationDraft(entryNotificationDraftReadSchema, value);
    return this.run('read', async context => {
      const original = context.original(command.operationKey), draft = await this.d.business.readNotificationDraft(context.actor.tenantId, original);
      context.check(); if (draft) await context.customer(draft.customerId);
      const current = await this.d.business.readNotificationDraft(context.actor.tenantId, original); context.check();
      if (!same(draft, current)) throw stale();
      if (current) await context.customer(current.customerId);
      return this.observed(command.operationKey, context.actor, current);
    }, signal);
  }

  /** Original resource observation for the outer registered Action signer.
   * The draft ID locates its immutable key; neither grants another actor access. */
  async readResource(value: unknown, signal?: AbortSignal): Promise<RentalNotificationDraftObservation> {
    const command = parseEntryNotificationDraft(entryNotificationDraftResourceSchema, value);
    return this.run('read', async context => {
      const original = { key: command.draftId.slice('notification-draft-'.length), actorId: context.actor.actorId };
      const draft = await this.d.business.readNotificationDraft(context.actor.tenantId, original); context.check();
      if (!draft || draft.id !== command.draftId) throw unavailable();
      await context.customer(draft.customerId);
      const current = await this.d.business.readNotificationDraft(context.actor.tenantId, original); context.check();
      if (!current || !same(draft, current)) throw stale();
      await context.customer(current.customerId);
      return current;
    }, signal);
  }
}
