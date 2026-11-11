import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { HttpException } from '@nestjs/common';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from './order-route-context.authority';
import { isAiStepExecutionContext } from './task-contract-validation';
import { ModelGatewayError } from './model-gateway.ports';
import { aiQuotePreviewInputSchema } from './quote-preview.service';
import { AiTaskRepositoryError } from './ai-task.repository';
import { BoundCalendarDraftUnknownError } from '../rental-core/bound-calendar-draft.service';
import { BoundRuleDraftUnknownError } from '../rental-core/bound-rule-draft.service';
import type { RentalQuoteRequest, RentalOrderExtensionRequest, PreviewRentalCalendarRangeOverrideRequest, ApplyRentalCalendarRangeOverrideRequest, SystemUserRow } from '@rental-os/shared';
import { z } from 'zod';

export type AiBusinessReadKind = 'catalog' | 'order_candidates' | 'availability' | 'membership_candidates' | 'booking_identity_options' | 'booking_delivery_addresses' | 'opening' | 'rule_versions' | 'rule_version' | 'calendar_version' | 'risk' | 'quote_context' | 'payment_intents' | 'payment_refunds';
/** Server-selected calendar partition, never a public permission switch. */
export interface AiCalendarSourceReadTarget { year: number; date: string }
export interface AiBusinessReadAuthority {
  withRead<T>(kind: AiBusinessReadKind, input: unknown, read: (context: AiExecutionContext) => Promise<T>): Promise<T>;
  withCalendarSourceRead?<T>(target: AiCalendarSourceReadTarget, read: (context: AiExecutionContext) => Promise<T>): Promise<T>;
}
const routes = {
  catalog: { method: 'GET', path: '/rental/v1/item-groups' },
  order_candidates: { method: 'GET', path: '/rental/v1/orders' },
  availability: { method: 'POST', path: '/rental/v1/availability' },
  membership_candidates: { method: 'GET', path: '/rental/v1/booking-members' },
  booking_identity_options: { method: 'GET', path: '/rental/v1/booking-members/:customerId/booking-options' },
  booking_delivery_addresses: { method: 'GET', path: '/rental/v1/booking-members/:customerId/delivery-addresses' },
  opening: { method: 'GET', path: '/rental/v1/tenant-readiness' },
  rule_versions: { method: 'GET', path: '/rental/v1/rule-versions' },
  rule_version: { method: 'GET', path: '/rental/v1/rule-versions/:version' },
  rule_draft_preview: { method: 'POST', path: '/rental/v1/rule-versions' },
  rule_draft_save: { method: 'POST', path: '/rental/v1/rule-versions' },
  calendar_version: { method: 'GET', path: '/rental/v1/calendars/:year/versions/:version' },
  calendar_range_preview: { method: 'POST', path: '/rental/v1/calendars/:year/days/range-preview' },
  calendar_range_apply: { method: 'POST', path: '/rental/v1/calendars/:year/days/range' },
  risk: { method: 'GET', path: '/rental/v1/reports/operations' },
  quote_context: { method: 'GET', path: '/rental/v1/business-settings' },
  payment_intents: { method: 'GET', path: '/rental/v1/orders/:orderId/payment-intents' },
  payment_refunds: { method: 'GET', path: '/rental/v1/orders/:orderId/payment-intents/:intentId/refunds' },
  quote: { method: 'POST', path: '/rental/v1/quotes' },
  extension_preview: { method: 'POST', path: '/rental/v1/orders/:orderId/extensions/preview' }
} as const;

/** Closed route bridge. The actual business read runs inside the Guard's ALS
 * identity; a context returned by resolve() alone cannot establish that store.
 * Sequential revalidation is not an atomic authorization transaction.
 */
export class AiBusinessReadRouteAuthority implements AiBusinessReadAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }

  async withRead<T>(kind: AiBusinessReadKind, input: unknown, read: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    if (['quote', 'extension_preview', 'calendar_range_apply', 'rule_draft_preview', 'rule_draft_save'].includes(kind as string)) throw new ModelGatewayError('INVALID_REQUEST');
    return this.withRoute(kind, input, read);
  }

  /** R1 persisted quote, explicitly separate from read tools. The bridge does
   * not grant approval, dispatch ownership, or permission to create an order. */
  async withQuote<T>(input: RentalQuoteRequest, consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const parsed = aiQuotePreviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    // Original Guard uses locationId for quote scope; never accept a second,
    // caller-selected location or silently drop return/service locations.
    return this.withRoute('quote', { ...parsed.data, locationId: parsed.data.fulfillmentLocationId }, async context => {
      if (!('access' in context)) throw new ModelGatewayError('FORBIDDEN');
      const locations = [parsed.data.fulfillmentLocationId, parsed.data.returnLocationId,
        ...(parsed.data.services?.map(row => row.serviceLocationId) ?? [])].filter((id): id is string => Boolean(id));
      if (context.access.locationScope?.mode === 'selected'
        && locations.some(id => !context.access.locationScope!.locationIds.includes(id))) throw new ModelGatewayError('FORBIDDEN');
      return consume(context);
    });
  }

  /** Existing Core preview only, with the SAME permission as its human route.
   * No apply/pay callback, arbitrary route, header or caller identity is exposed. */
  async withExtensionPreview<T>(orderId: string, input: RentalOrderExtensionRequest,
    consume: (context: AiExecutionContext, request: { user: SystemUserRow }) => Promise<T>): Promise<T> {
    const command = structuredClone(input);
    return this.withRoute('extension_preview', { ...command, orderId }, async (context, request) => {
      if (!request || !('access' in context)) throw new ModelGatewayError('FORBIDDEN');
      const locations = command.services?.map(row => row.serviceLocationId).filter((id): id is string => Boolean(id)) ?? [];
      if (context.access.locationScope?.mode === 'selected'
        && locations.some(id => !context.access.locationScope!.locationIds.includes(id))) throw new ModelGatewayError('FORBIDDEN');
      return consume(context, request);
    });
  }

  /** Original calendar edit-preview permission, not history/read permission.
   * The POST observes draft material but never applies, publishes or approves it. */
  async withCalendarRangePreview<T>(year: number, input: PreviewRentalCalendarRangeOverrideRequest,
    consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const command = structuredClone(input);
    return this.withRoute('calendar_range_preview', { ...command, year }, context => consume(context));
  }

  /** Necessary Core inputs under the actual calendar-edit preview Guard. The
   * callback does not apply the empty range or read another opening partition. */
  async withCalendarSourceRead<T>(target: AiCalendarSourceReadTarget,
    consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const parsed = z.object({ year: z.number().int().min(1900).max(2200),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).strict().safeParse(structuredClone(target));
    if (!parsed.success || Number(parsed.data.date.slice(0, 4)) !== parsed.data.year)
      throw new ModelGatewayError('INVALID_REQUEST');
    return this.withCalendarRangePreview(parsed.data.year, { startDate: parsed.data.date,
      endDate: parsed.data.date, fields: {} }, consume);
  }

  /** Explicit existing calendar-edit route, distinct from preview and history.
   * Server-only bound Core persistence; never grants publication or arbitrary fields. */
  async withCalendarDraftWrite<T>(year: number, input: ApplyRentalCalendarRangeOverrideRequest,
    consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    let entered = false;
    try {
      return await this.withRoute('calendar_range_apply', { ...structuredClone(input), year }, context => { entered = true; return consume(context); });
    } catch (error) {
      if (entered && !(error instanceof AiTaskRepositoryError && error.code === 'AI_REVISION_CONFLICT'))
        throw new BoundCalendarDraftUnknownError();
      throw error;
    }
  }

  /** Reuse the original rule EDIT Guard for a server-only validation callback.
   * Publish/history permission cannot authorize this preview. No HTTP handler
   * or save method is invoked, and no caller rule/config/path is transported. */
  async withRuleDraftPreview<T>(targetId: string, consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const parsed = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(targetId);
    if (!parsed.success || typeof consume !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    return this.withRoute('rule_draft_preview', { versionId: parsed.data }, context => consume(context));
  }

  /** The SAME original rules:manage Guard, with R1 outcome semantics. A draft
   * mutation or its closing authorization can fail after COMMIT; do not route
   * that unknown through the preview's optional-source error normalization. */
  async withRuleDraftSave<T>(targetId: string, consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const parsed = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(targetId);
    if (!parsed.success || typeof consume !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    let entered = false;
    try { return await this.withRoute('rule_draft_save', { versionId: parsed.data }, context => { entered = true; return consume(context); }); }
    catch (error) {
      if (!entered || error instanceof AiTaskRepositoryError && error.code === 'AI_REVISION_CONFLICT'
        || error instanceof HttpException && error.getStatus() === 400) throw error;
      throw new BoundRuleDraftUnknownError();
    }
  }

  private async withRoute<T>(kind: keyof typeof routes, input: unknown,
    read: (context: AiExecutionContext, request?: { user: SystemUserRow }) => Promise<T>): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(routes, kind) || typeof read !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    const body = structuredClone(input);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ModelGatewayError('INVALID_REQUEST');
    if (kind === 'rule_versions' && Object.keys(body).length !== 0) throw new ModelGatewayError('INVALID_REQUEST');
    let route: { method: string; path: string } = routes[kind];
    if (kind === 'calendar_range_apply') {
      const parsed = z.object({ year: z.number().int().min(1900).max(2200), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), fields: z.object({ name: z.string().min(1).max(120).optional(),
          businessStatus: z.enum(['open', 'limited', 'closed', 'self_service']).optional() }).strict(),
        expectedRevision: z.number().int().min(0).max(4294967294), overrideReason: z.string().trim().min(1).max(1000),
        overrideConfirmed: z.boolean(), batchId: z.string().min(1).max(191) }).strict().safeParse(body);
      if (!parsed.success || parsed.data.startDate !== parsed.data.endDate || Number(parsed.data.startDate.slice(0, 4)) !== parsed.data.year)
        throw new ModelGatewayError('INVALID_REQUEST');
      route = { ...route, path: route.path.replace(':year', String(parsed.data.year)) };
    }
    if (kind === 'calendar_range_preview') {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
      const parsed = z.object({ year: z.number().int().min(1900).max(2200), startDate: date, endDate: date,
        fields: z.object({ name: z.string().min(1).max(120).optional(),
          businessStatus: z.enum(['open', 'limited', 'closed', 'self_service']).optional() }).strict()
      }).strict().safeParse(body);
      if (!parsed.success || parsed.data.startDate !== parsed.data.endDate
        || Number(parsed.data.startDate.slice(0, 4)) !== parsed.data.year) throw new ModelGatewayError('INVALID_REQUEST');
      route = { ...route, path: route.path.replace(':year', String(parsed.data.year)) };
    }
    if (kind === 'rule_version' || kind === 'calendar_version') {
      const version = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
      const schema = kind === 'rule_version' ? z.object({ version }).strict()
        : z.object({ version, year: z.number().int().min(1900).max(2200) }).strict();
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
      route = { method: 'GET', path: route.path.replace(':version', parsed.data.version) };
      if ('year' in parsed.data) route = { ...route, path: route.path.replace(':year', String(parsed.data.year)) };
    }
    if (kind === 'booking_identity_options' || kind === 'booking_delivery_addresses') {
      const parsed = z.object({ customerId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict().safeParse(body);
      if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
      route = { method: 'GET', path: route.path.replace(':customerId', parsed.data.customerId) };
    }
    if (kind === 'payment_intents' || kind === 'payment_refunds') {
      const resourceId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
      const parsed = (kind === 'payment_intents' ? z.object({ orderId: resourceId }).strict()
        : z.object({ orderId: resourceId, intentId: resourceId }).strict()).safeParse(body);
      if (!parsed.success || ['expire-pending', 'reconcile-pickup-overdue'].includes(parsed.data.orderId.toLowerCase())) throw new ModelGatewayError('INVALID_REQUEST');
      route = { method: 'GET', path: route.path.replace(':orderId', parsed.data.orderId)
        .replace(':intentId', 'intentId' in parsed.data ? String(parsed.data.intentId) : '') };
    }
    if (kind === 'extension_preview') {
      const parsed = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u).safeParse((body as Record<string, unknown>).orderId);
      if (!parsed.success || ['expire-pending', 'reconcile-pickup-overdue'].includes(parsed.data.toLowerCase())) throw new ModelGatewayError('INVALID_REQUEST');
      route = { ...route, path: route.path.replace(':orderId', parsed.data) };
    }
    const authorize = async <R>(consume: (context: AiExecutionContext, request: { user: SystemUserRow }) => Promise<R>): Promise<R> => {
      const credential = structuredClone(await this.credentials.current());
      if (!credential || !['operator', 'staff'].includes(credential.audience)
        || typeof credential.authorization !== 'string' || credential.authorization.length > 8192
        || typeof credential.requestId !== 'string') throw new ModelGatewayError('FORBIDDEN');
      return runWithRequestIdentity({}, async () => {
        const staff = credential.audience === 'staff';
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: unknown; staffApiRequest: boolean; user?: SystemUserRow } = {
          url: `/api${route.path}`, originalUrl: `/api${staff ? route.path.replace('/rental/v1/', '/staff/v1/') : route.path}`,
          method: route.method, headers: { authorization: credential.authorization }, query: route.method === 'GET' ? structuredClone(body) : {}, body: structuredClone(body), staffApiRequest: staff
        };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new ModelGatewayError('FORBIDDEN');
        const user = request.user, identity = getRequestIdentity(), now = this.clock();
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || !identity.workspaceId
          || identity.userId !== user.id || identity.tenantId !== user.tenantId || identity.staffApi !== staff
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('FORBIDDEN');
        const context = {
          contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: credential.audience, actor: { kind: 'user', userId: user.id },
          scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId },
          access: { permissions: user.permissions, dataScope: identity.dataScope, locationScope: identity.locationScope,
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) }
        };
        if (!isAiStepExecutionContext(context)) throw new ModelGatewayError('FORBIDDEN');
        return consume(structuredClone(context), { user: structuredClone(user) });
      });
    };
    const binding = (context: AiExecutionContext) => {
      const { requestId: _request, authorizedAt: _time, ...identity } = context;
      return requestFingerprint(identity);
    };
    try {
      return await authorize(async (context, request) => {
        const before = binding(context);
        // withQuote is R1 work, not an optional read. Keep its existing
        // outcome/unknown handling separate from read-source degradation.
        if (kind === 'quote' || kind === 'calendar_range_apply' || kind === 'rule_draft_save') {
          const result = await read(context);
          await authorize(async current => { if (binding(current) !== before) throw new ModelGatewayError('FORBIDDEN'); });
          return result;
        }
        let result!: T, failure: unknown, failed = false;
        try { result = kind === 'extension_preview' ? await read(context, request) : await read(context); }
        catch (error) { failure = error; failed = true; }
        // Recheck even failed reads: an optional-source downgrade must never
        // swallow a concurrent revocation. Only the business fault, not a
        // Guard/session failure, may become a safe unavailable response.
        await authorize(async current => { if (binding(current) !== before) throw new ModelGatewayError('FORBIDDEN'); });
        if (failed) {
          // This new validation leaf preserves a definite Core rejection only
          // AFTER the existing closing Guard, never as optional-source success.
          if (kind === 'rule_draft_preview' && failure instanceof HttpException && failure.getStatus() === 400) throw failure;
          if (kind === 'rule_draft_preview' && failure instanceof HttpException && failure.getStatus() === 409)
            throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          if (kind === 'rule_draft_preview' && failure instanceof AiTaskRepositoryError && failure.code === 'AI_REVISION_CONFLICT') throw failure;
          if (kind === 'extension_preview' && failure instanceof AiTaskRepositoryError && failure.code === 'AI_REVISION_CONFLICT') throw failure;
          const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : undefined;
          if (typeof code === 'string' && ['FORBIDDEN', 'AUTHENTICATION_FAILED', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(code))
            throw new ModelGatewayError('FORBIDDEN');
          if (failure instanceof ModelGatewayError) throw failure;
          if (failure instanceof HttpException && [401, 403].includes(failure.getStatus())) throw new ModelGatewayError('FORBIDDEN');
          throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
        }
        return result;
      });
    } catch (error) {
      if (kind === 'rule_draft_save' && error instanceof BoundRuleDraftUnknownError) throw error;
      if (kind === 'rule_draft_save' && error instanceof HttpException && error.getStatus() === 400) throw error;
      if (kind === 'rule_draft_save' && error instanceof HttpException && error.getStatus() === 409)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if (kind === 'rule_draft_preview' && error instanceof HttpException && error.getStatus() === 400) throw error;
      if (kind === 'rule_draft_preview' && error instanceof AiTaskRepositoryError && error.code === 'AI_REVISION_CONFLICT') throw error;
      if (kind === 'calendar_range_apply' && error instanceof BoundCalendarDraftUnknownError) throw error;
      if (kind === 'calendar_range_apply' && error instanceof HttpException && error.getStatus() === 409)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if (kind === 'extension_preview' && error instanceof AiTaskRepositoryError && error.code === 'AI_REVISION_CONFLICT') throw error;
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError('FORBIDDEN');
    }
  }
}
