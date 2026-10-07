import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from './order-route-context.authority';
import { isAiStepExecutionContext } from './task-contract-validation';
import { ModelGatewayError } from './model-gateway.ports';
import { aiQuotePreviewInputSchema } from './quote-preview.service';
import type { RentalQuoteRequest } from '@rental-os/shared';

export type AiBusinessReadKind = 'catalog' | 'availability' | 'membership_candidates' | 'opening' | 'risk' | 'quote_context';
export interface AiBusinessReadAuthority {
  withRead<T>(kind: AiBusinessReadKind, input: unknown, read: (context: AiExecutionContext) => Promise<T>): Promise<T>;
}
const routes = {
  catalog: { method: 'GET', path: '/rental/v1/item-groups' },
  availability: { method: 'POST', path: '/rental/v1/availability' },
  membership_candidates: { method: 'GET', path: '/rental/v1/booking-members' },
  opening: { method: 'GET', path: '/rental/v1/tenant-readiness' },
  risk: { method: 'GET', path: '/rental/v1/reports/operations' },
  quote_context: { method: 'GET', path: '/rental/v1/business-settings' },
  quote: { method: 'POST', path: '/rental/v1/quotes' }
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
    if ((kind as string) === 'quote') throw new ModelGatewayError('INVALID_REQUEST');
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

  private async withRoute<T>(kind: keyof typeof routes, input: unknown, read: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(routes, kind) || typeof read !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    const body = structuredClone(input);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ModelGatewayError('INVALID_REQUEST');
    const route = routes[kind];
    const authorize = async <R>(consume: (context: AiExecutionContext) => Promise<R>): Promise<R> => {
      const credential = structuredClone(await this.credentials.current());
      if (!credential || !['operator', 'staff'].includes(credential.audience)
        || typeof credential.authorization !== 'string' || credential.authorization.length > 8192
        || typeof credential.requestId !== 'string') throw new ModelGatewayError('FORBIDDEN');
      return runWithRequestIdentity({}, async () => {
        const staff = credential.audience === 'staff';
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: unknown; staffApiRequest: boolean; user?: { id: string; tenantId: string; isActive: boolean; isSaasAdmin?: boolean; permissions?: string[] } } = {
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
        return consume(structuredClone(context));
      });
    };
    const binding = (context: AiExecutionContext) => {
      const { requestId: _request, authorizedAt: _time, ...identity } = context;
      return requestFingerprint(identity);
    };
    try {
      return await authorize(async context => {
        const before = binding(context);
        const result = await read(context);
        await authorize(async current => { if (binding(current) !== before) throw new ModelGatewayError('FORBIDDEN'); });
        return result;
      });
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError('FORBIDDEN');
    }
  }
}
