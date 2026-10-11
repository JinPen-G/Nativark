import type { PrismaClient } from '@prisma/client';
import type { SecretBox } from '../../common/secret-box';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { createPersistedTenantModelConfiguration } from './tenant-model-config.composition';
import { createAuthorizedPlatformModelConfiguration } from './platform-model-config.composition';
import { PrismaTaskBudgetAuthorizationSource } from './budget/prisma-task-budget-authorization.source';
import { TextCapabilityProbeApplication, type TextCapabilityProbeDependencies } from './text-capability-probe.application';
import { composePersistedTextProbeWorkflow } from './text-capability-probe-task.composition';

export type AuthorizedTextProbeWorkflowDependencies = Omit<PersistedTaskAuthorizationDependencies, 'db'> & {
  db: PrismaClient;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  secrets: SecretBox;
  /** Server-selected platform profile, not a request/model-supplied ID. */
  platformProfileId: string;
  pricing: TextCapabilityProbeDependencies['pricing'];
  audit: TextCapabilityProbeDependencies['audit'];
  protocol?: TextCapabilityProbeDependencies['protocol'];
  host: Parameters<typeof composePersistedTextProbeWorkflow>[0]['host'];
  sceneVersion: string;
  priceVersion: string;
  monotonic?: () => number;
};

/** Explicit request-scoped root: real current identity/configuration and Vault,
 * task policies, single financial ledger and its own dispatch evidence. No
 * policy creation, task start, credential access or provider call on assembly.
 * Versioned trusted pricing and existing host are still mandatory. */
export function composeAuthorizedPersistedTextProbeWorkflow(input: AuthorizedTextProbeWorkflowDependencies) {
  const current = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, input.clock);
  const management = new TenantModelConfigurationAuthority(input.guard, input.credentials, current);
  const configuration = createPersistedTenantModelConfiguration({ db: input.db, secrets: input.secrets,
    authorize: (context, action) => management.authorize(context, action) });
  const platform = createAuthorizedPlatformModelConfiguration({ db: input.db, guard: input.guard,
    credentials: input.credentials, invocation: current, profileId: input.platformProfileId, secrets: input.secrets });
  const authorization = new PrismaTaskBudgetAuthorizationSource(input);
  const application = new TextCapabilityProbeApplication({ db: input.db, scopes: authorization.scopes,
    subscriptions: input.subscriptions, authorization, management, configuration, platformConnection: platform.invocation,
    pricing: input.pricing, audit: input.audit, protocol: input.protocol, clock: input.clock });
  const workflow = composePersistedTextProbeWorkflow({ ...input, probe: application,
    financialEvidence: application.financialEvidence });
  return Object.freeze({ application, workflow });
}
