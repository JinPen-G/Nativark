import type { AiExecutionContext, RentalQuoteRequest } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { BusinessContext } from '../../rental-core/rental-business.service';
import type { AiBusinessReadRouteAuthority, AiCalendarSourceReadTarget } from '../business-read-route.authority';
import type { AiQuoteCoreContextSource, AiQuotePreviewAuthority } from '../quote-preview.service';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiQuotePreviewService } from '../quote-preview.service';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { AiQuoteCandidatePreparationService } from './quote-candidate-preparation.service';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import { parseQuoteAddresses, quoteAddressIdentity, type AiQuoteAddressSource } from '../scenes/original-quote-address';

/** Original quote Guard/ALS only. Enterprise-employee selections reach Core's
 * current membership and quote-credit checks, not a new signing/payment grant.
 * Direct corporate users are unsupported by the original member quote flow. */
export class AiQuoteRouteAuthority implements AiQuotePreviewAuthority {
  constructor(private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withQuote'>) {
    if (typeof routes?.withQuote !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async withQuote<T>(input: RentalQuoteRequest, consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(input);
    if (snapshot?.customerType === 'corporate') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    // Preserve the selected payer intent. Core re-resolves the current personal
    // member and enterprise relationship and applies its quote-credit rules.
    // Those quote facts do not attest order subjects, payment or credit capacity.
    return this.routes.withQuote(snapshot, consume);
  }
}

type ContextCore = Pick<RentalCoreService, 'readQuoteConfiguration'>;

/** Dedicated bounded persisted Core source under the existing settings-read
 * Guard/ALS, never state/cache getters or recovery snapshots. Preparation can
 * bind its enclosing server principal before Core access; scope/context are not
 * new authority. Legacy source callers retain the original one-argument port. */
export class AiGuardedQuoteCoreContextSource implements AiQuoteCoreContextSource {
  constructor(private readonly core: ContextCore, private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withRead'>
    & Partial<Pick<AiBusinessReadRouteAuthority, 'withCalendarSourceRead'>>) {
    if (typeof core?.readQuoteConfiguration !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    if (typeof routes?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async current(expected: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>, expectedContext?: AiExecutionContext,
    calendar?: AiCalendarSourceReadTarget & { readVersion?: string }): Promise<BusinessContext> {
    if (expected?.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(expected), principal = expectedContext && structuredClone(expectedContext);
    const consume = async (context: AiExecutionContext): Promise<BusinessContext> => {
      assertAiReadContextBinding(context, principal);
      if (context.scope.kind !== 'workspace' || context.scope.tenantId !== scope.tenantId
        || context.scope.workspaceId !== scope.workspaceId) throw new ModelGatewayError('FORBIDDEN');
      const tenantId = context.scope.tenantId;
      const facts = structuredClone(await this.core.readQuoteConfiguration(tenantId));
      if (facts.tenantId !== tenantId || facts.workspaceId !== scope.workspaceId || facts.profile.tenantId !== tenantId
        || facts.settings.tenantId !== tenantId || facts.profile.categoryCode !== facts.category.code) throw new ModelGatewayError('INVALID_RESPONSE');
      return { ...(facts.categoryVersionId ? { categoryVersionId: facts.categoryVersionId, categoryAdoptionRevision: facts.categoryAdoptionRevision } : {}), profile: facts.profile, category: facts.category, settings: facts.settings, groups: facts.groups,
        pricingGroups: facts.pricingGroups, couponTemplates: facts.couponTemplates, locations: facts.locations, operators: facts.operators };
    };
    if (calendar) {
      if (calendar.readVersion !== undefined) return this.routes.withRead('calendar_version', {
        year: calendar.year, version: calendar.readVersion }, consume);
      if (!this.routes.withCalendarSourceRead) throw new ModelGatewayError('CONFIG_INVALID');
      return this.routes.withCalendarSourceRead(calendar, consume);
    }
    return this.routes.withRead('quote_context', {}, consume);
  }
}

/** No automatic candidate-to-write transition: the host presents preparation
 * and explicitly invokes preview with confirmed parameters through its normal
 * authorized task path. No runner/approval/dispatch is installed here. */
export function composeAiGuardedQuoteTools(input: {
  core: ContextCore & Pick<RentalCoreService, 'resolvePricingGroupQuoteRequest'>;
  business: Pick<RentalBusinessService, 'createQuote'> & Partial<Pick<RentalBusinessService, 'normalizeQuoteInput' | 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation' | 'readQuoteForOriginalReference' | 'readQuoteRateTargets' | 'listCustomerDeliveryAddresses'>>;
  routes: AiBusinessReadRouteAuthority;
  readers: { catalog: Pick<AiCatalogReadFactsService, 'read'>; members: Pick<AiMembershipCandidateReadFactsService, 'read'>
    & Partial<Pick<AiMembershipCandidateReadFactsService, 'readBookingOptions'>> };
  clock?: () => Date;
}) {
  if (typeof input?.core?.resolvePricingGroupQuoteRequest !== 'function' || typeof input?.business?.createQuote !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const context = new AiGuardedQuoteCoreContextSource(input.core, input.routes);
  const authority = new AiQuoteRouteAuthority(input.routes);
  const addresses: AiQuoteAddressSource | undefined = typeof input.business.listCustomerDeliveryAddresses === 'function' ? {
    list: async (scope, customerId) => {
      const expected = structuredClone(scope);
      return input.routes.withRead('booking_delivery_addresses', { customerId }, async current => {
        if (current.audience !== 'operator' || requestFingerprint(current.scope) !== requestFingerprint(expected)) throw new ModelGatewayError('FORBIDDEN');
        const rows = parseQuoteAddresses(await input.business.listCustomerDeliveryAddresses!(expected.tenantId, customerId));
        return { rows, identityHash: quoteAddressIdentity(current) };
      });
    }
  } : undefined;
  const candidates = new AiQuoteCandidatePreparationService({ ...input.readers, addresses,
    ...(typeof input.business.readQuoteRateTargets === 'function' ? { rates: {
      read: async (scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>, supplied: BusinessContext, at: string,
        expectedContext?: AiExecutionContext) => {
        const expected = structuredClone(scope), snapshot = structuredClone(supplied);
        const principal = expectedContext && structuredClone(expectedContext);
        return input.routes.withRead('quote_context', {}, async current => {
          // Rate values/configuration can be identical under another principal.
          // Bind this Guard to the enclosing preparation before the lookup,
          // and bind its nested configuration Guard to this current reader.
          assertAiReadContextBinding(current, principal);
          if (requestFingerprint(current.scope) !== requestFingerprint(expected)
            || requestFingerprint(await context.current(expected, current)) !== requestFingerprint(snapshot)) throw new ModelGatewayError('FORBIDDEN');
          return structuredClone(await input.business.readQuoteRateTargets!(expected.tenantId, snapshot, at));
        });
      }
    } } : {})
  }, context, input.clock, input.routes);
  const preview = new AiQuotePreviewService(input.business, context, authority, input.clock, input.core, addresses);
  // Historical observations use the same original Guard, not the new-effect
  // payer gate. This instance is exposed only through exact-key recovery.
  const history = new AiQuotePreviewService(input.business, context, input.routes, input.clock, input.core);
  return Object.freeze({
    candidates, preview,
    recoverOriginal: (reference: string, expectedIdentityHash: string) => input.routes.withRead('quote_context', {}, async context => {
      const { requestId: _request, authorizedAt: _at, ...identity } = context;
      if (requestFingerprint(identity) !== expectedIdentityHash) throw new ModelGatewayError('FORBIDDEN');
      return history.recoverOriginal(reference, context);
    }),
    /** Host calls after explicit candidate selection. Revision is consistency
     * evidence only, never approval to create an order. Re-resolve every ID and
     * bind the current server context to the original guarded Core quote. */
    previewSelection: async (value: unknown) => {
      const supplied = structuredClone(value);
      const prepared = await candidates.prepare(supplied);
      if (prepared.status !== 'needs_confirmation') return prepared;
      const revision = supplied && typeof supplied === 'object' && !Array.isArray(supplied)
        ? (supplied as Record<string, unknown>).selectionRevision : undefined;
      if (revision !== prepared.selectionRevision) return { status: 'missing_input' as const, missingFields: ['selectionRevision'],
        selectionRevision: prepared.selectionRevision, clarifications: [{ field: 'selectionRevision', reason: 'explicit_confirmation_required',
          action: 'review_and_confirm_current_candidates', candidates: [] }] };
      return preview.preview(prepared.request, prepared.configurationFingerprint, prepared.addressFingerprint);
    }
  });
}
