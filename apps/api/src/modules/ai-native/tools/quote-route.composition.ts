import type { AiExecutionContext, RentalQuoteRequest } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { BusinessContext } from '../../rental-core/rental-business.service';
import type { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import type { AiQuoteCoreContextSource, AiQuotePreviewAuthority } from '../quote-preview.service';
import { ModelGatewayError } from '../model-gateway.ports';
import { AiQuotePreviewService } from '../quote-preview.service';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { AiQuoteCandidatePreparationService } from './quote-candidate-preparation.service';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';

/** Server-side fixed quote route. Corporate identity/qualification has no
 * trusted adapter here; never reinterpret it as personal membership. */
export class AiQuoteRouteAuthority implements AiQuotePreviewAuthority {
  constructor(private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withQuote'>) {
    if (typeof routes?.withQuote !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async withQuote<T>(input: RentalQuoteRequest, consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    if (input?.customerType === 'corporate') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return this.routes.withQuote(input, consume);
  }
}

type ContextCore = Pick<RentalCoreService, 'getProfile' | 'getWorkspaceCategory' | 'getBusinessSettings' | 'listItemGroups'
  | 'listPricingGroups' | 'listCouponTemplates' | 'listLocations' | 'listOperators'>;

/** Same public Core sources as the manual controller, resolved under the
 * existing settings-read Guard and ALS. Expected scope is only a binding to
 * compare with the authenticated session, never a source of authority. */
export class AiGuardedQuoteCoreContextSource implements AiQuoteCoreContextSource {
  constructor(private readonly core: ContextCore, private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withRead'>) {
    for (const method of ['getProfile', 'getWorkspaceCategory', 'getBusinessSettings', 'listItemGroups', 'listPricingGroups',
      'listCouponTemplates', 'listLocations', 'listOperators'] as const) {
      if (typeof core?.[method] !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    }
    if (typeof routes?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async current(expected: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>): Promise<BusinessContext> {
    const scope = structuredClone(expected);
    return this.routes.withRead('quote_context', {}, async context => {
      if (context.scope.kind !== 'workspace' || context.scope.tenantId !== scope.tenantId
        || context.scope.workspaceId !== scope.workspaceId) throw new ModelGatewayError('FORBIDDEN');
      const tenantId = context.scope.tenantId;
      const category = await this.core.getWorkspaceCategory(tenantId);
      const result = structuredClone({ profile: this.core.getProfile(tenantId), category,
        settings: this.core.getBusinessSettings(tenantId), groups: this.core.listItemGroups(tenantId),
        pricingGroups: this.core.listPricingGroups(tenantId), couponTemplates: this.core.listCouponTemplates(tenantId),
        locations: this.core.listLocations(tenantId), operators: this.core.listOperators(tenantId) });
      if (result.profile.tenantId !== tenantId || result.settings.tenantId !== tenantId
        || result.profile.categoryCode !== category.code) throw new ModelGatewayError('INVALID_RESPONSE');
      return result;
    });
  }
}

/** No automatic candidate-to-write transition: the host presents preparation
 * and explicitly invokes preview with confirmed parameters through its normal
 * authorized task path. No runner/approval/dispatch is installed here. */
export function composeAiGuardedQuoteTools(input: {
  core: ContextCore & Pick<RentalCoreService, 'resolvePricingGroupQuoteRequest'>;
  business: Pick<RentalBusinessService, 'createQuote'>;
  routes: AiBusinessReadRouteAuthority;
  readers: { catalog: Pick<AiCatalogReadFactsService, 'read'>; members: Pick<AiMembershipCandidateReadFactsService, 'read'> };
  clock?: () => Date;
}) {
  if (typeof input?.core?.resolvePricingGroupQuoteRequest !== 'function' || typeof input?.business?.createQuote !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const context = new AiGuardedQuoteCoreContextSource(input.core, input.routes);
  const authority = new AiQuoteRouteAuthority(input.routes);
  return Object.freeze({
    candidates: new AiQuoteCandidatePreparationService(input.readers, context, input.clock),
    preview: new AiQuotePreviewService(input.business, context, authority, input.clock, input.core)
  });
}
