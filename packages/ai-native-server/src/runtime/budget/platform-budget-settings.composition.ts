/** Original Rental/Web identity adapter for the same platform budget settings. */
import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../rental-adapters/api-auth.guard';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { PlatformModelConfigurationAuthority } from '../platform-model-config.authority';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { BudgetError } from './budget.ports';
import { createPlatformBudgetSettings } from './platform-budget-settings.service';

export function createAuthorizedPlatformBudgetSettings(input: {
  db: ConstructorParameters<typeof PrismaBudgetRepository>[0] & Pick<PrismaClient, 'aiProviderProfile'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  profileId: string;
  clock?: () => Date;
}) {
  const { db, guard, credentials, profileId, clock } = input;
  const authority = new PlatformModelConfigurationAuthority(guard, credentials, profileId,
    { resolve: async () => { throw new BudgetError('FORBIDDEN'); } }, clock);
  // Keep the legacy per-request identity and transaction selection intact.
  return createPlatformBudgetSettings({ db, authority, profileId, clock,
    repository: platform => new PrismaBudgetRepository(db, clock, platform ? { platform } : undefined) });
}
