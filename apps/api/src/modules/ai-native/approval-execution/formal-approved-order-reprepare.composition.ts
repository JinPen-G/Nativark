/** Reuses original request/selection/lease authorities, not quote or Core execution.
 * Complete candidates use the standard guarded configuration/rate/address ports;
 * legacy incomplete candidates never invent missing rates or execution rights. */
import type { BusinessContext } from '../../rental-core/rental-business.service';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import { AiMembershipCandidateReadFactsService, type AiMembershipCandidateReadPort } from '../membership-candidate-read-facts.service';
import { AiQuoteCandidatePreparationService } from '../tools/quote-candidate-preparation.service';
import { composeAiGuardedQuoteTools } from '../tools/quote-route.composition';
import { AiCurrentOriginalRequestAuthority, type AiSceneCreationRule } from '../task-request/original-request.authority';
import { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { PrismaQuoteSelectionRepository } from '../task-request/prisma-quote-selection.repository';
import { PersistedApprovedOrderHeldLeaseSource } from './persisted-approved-order-held-lease.source';
import { deniedOrder } from './prisma-approved-order.source';

export interface FormalApprovedOrderReprepareConfiguration {
  holderId: string;
  creationRules: readonly AiSceneCreationRule[];
  memberships: AiMembershipCandidateReadPort;
}

export function composeFormalApprovedOrderReprepareServices(d: ControlledApprovedOrderDependencies, configuration: FormalApprovedOrderReprepareConfiguration) {
  if (!configuration || !Array.isArray(configuration.creationRules) || configuration.creationRules.length !== 1
    || configuration.creationRules[0].sceneCode !== 'quote_clarification' || d.scene.code !== 'quote_clarification'
    || configuration.creationRules[0].sceneVersion !== d.scene.version
    || typeof configuration.memberships?.listPersonalOptions !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const clock = d.clock ?? (() => new Date());
  const lease = new PersistedApprovedOrderHeldLeaseSource(d, configuration.holderId);
  const routes = new AiBusinessReadRouteAuthority(d.guard, d.credentials, clock);
  const readers = { catalog: new AiCatalogReadFactsService(d.core, routes, clock),
    members: new AiMembershipCandidateReadFactsService(configuration.memberships, routes, clock) };
  const business = d.business && typeof d.business.createQuote === 'function'
    && typeof d.business.readQuoteRateTargets === 'function' ? d.business : undefined;
  if (business && (typeof d.core.readQuoteConfiguration !== 'function' || typeof d.core.resolvePricingGroupQuoteRequest !== 'function'))
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  // Reuse the registered guarded quote composition: real current configuration,
  // rates and optional addresses, never a second price algorithm or raw facts.
  const candidates = business ? composeAiGuardedQuoteTools({ core: {
    readQuoteConfiguration: d.core.readQuoteConfiguration!.bind(d.core),
    resolvePricingGroupQuoteRequest: d.core.resolvePricingGroupQuoteRequest!.bind(d.core)
  }, business, routes, readers, clock }).candidates : new AiQuoteCandidatePreparationService(readers, {
    current: async scope => {
      if (scope.kind !== 'workspace' || d.core.resolveWorkspaceId(scope.tenantId) !== scope.workspaceId) throw deniedOrder();
      const tenant = scope.tenantId;
      const context: BusinessContext = await d.core.readBusinessContext(tenant);
      return context;
    }
  }, clock);
  const authority = new AiCurrentOriginalRequestAuthority(d.db, { ...d, creationRules: configuration.creationRules,
    authorizeResources: async body => {
      if (body.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return routes.withRead('quote_context', {}, async context => {
        const prepared = await candidates.prepare(body.input.candidate, context);
        if (prepared.status === 'unavailable' || prepared.status === 'qualification_required') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return context;
      });
    }
  }, clock);
  const originals = new PrismaOriginalRequestRepository(d.db, authority, clock);
  const selection = new PrismaQuoteSelectionRepository({ ...d, originals });
  return Object.freeze({ originals, selection, lease });
}
