import type { RentalCoreService } from '../rental-core/rental-core.service';
import { ModelGatewayError } from './model-gateway.ports';
import { AiAvailabilityReadFactsService } from './availability-read-facts.service';
import { AiCatalogReadFactsService, type AiCatalogReadPort } from './catalog-read-facts.service';
import { AiMembershipCandidateReadFactsService, type AiMembershipCandidateReadPort } from './membership-candidate-read-facts.service';
import { AiOrderReadFactsService } from './order-read-facts.service';
import type { AiBusinessReadAuthority } from './business-read-route.authority';
import type { AiOrderRouteContextAuthority } from './order-route-context.authority';

/**
 * Dependencies for the AIN-08 read-only fact composition.
 *
 * These are server-selected ports. Nothing in this object is accepted from a
 * model/tool request, and this factory does not register an HTTP route or a
 * dispatch handler.
 */
export interface AiBusinessReadFactsCompositionInput {
  core: Pick<RentalCoreService, 'readAvailability' | 'getOrder'> & AiCatalogReadPort;
  memberships: AiMembershipCandidateReadPort;
  businessAuthority: AiBusinessReadAuthority;
  orderAuthority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>;
  clock?: () => Date;
}

export interface AiUnavailableBusinessRead {
  readonly status: 'unavailable';
  readonly code: 'AI_RESOURCE_UNAVAILABLE';
  readonly reason: string;
}

export interface AiBusinessReadFactsComposition {
  readonly catalog: AiCatalogReadFactsService;
  readonly availability: AiAvailabilityReadFactsService;
  readonly membershipCandidates: AiMembershipCandidateReadFactsService;
  readonly order: AiOrderReadFactsService;
  /** No bounded AI projection exists for these Core routes in this slice. */
  readonly readiness: AiUnavailableBusinessRead;
  readonly workbenchTodos: AiUnavailableBusinessRead;
}

const unavailable = (reason: string): AiUnavailableBusinessRead => Object.freeze({
  status: 'unavailable', code: 'AI_RESOURCE_UNAVAILABLE', reason
});

const requireMethod = (value: unknown, name: string): void => {
  if (!value || typeof (value as Record<string, unknown>)[name] !== 'function') {
    throw new ModelGatewayError('CONFIG_INVALID');
  }
};

/**
 * Explicit, disabled-until-composed AIN-08 read composition.
 *
 * It constructs the existing bounded readers instead of duplicating their
 * validation or authorization. It deliberately does not make them an AI
 * tool registry, does not change AI_TOOL_BASELINE maturity, and does not
 * install providers in AppModule.
 */
export function composeAiBusinessReadFacts(
  input: AiBusinessReadFactsCompositionInput
): AiBusinessReadFactsComposition {
  requireMethod(input?.core, 'listItemGroupsPage');
  requireMethod(input?.core, 'readAvailability');
  requireMethod(input?.core, 'getOrder');
  requireMethod(input?.memberships, 'listPersonalOptions');
  requireMethod(input?.businessAuthority, 'withRead');
  requireMethod(input?.orderAuthority, 'withOrderRead');

  const clock = input.clock ?? (() => new Date());
  return Object.freeze({
    catalog: new AiCatalogReadFactsService(input.core, input.businessAuthority, clock),
    availability: new AiAvailabilityReadFactsService(input.core, input.businessAuthority, clock),
    membershipCandidates: new AiMembershipCandidateReadFactsService(input.memberships, input.businessAuthority, clock),
    order: new AiOrderReadFactsService(input.core, input.orderAuthority as AiOrderRouteContextAuthority, clock),
    readiness: unavailable('AIN-08 readiness projection requires a bounded diagnostic contract'),
    workbenchTodos: unavailable('AIN-08 workbench todo projection requires a bounded evidence contract')
  });
}
