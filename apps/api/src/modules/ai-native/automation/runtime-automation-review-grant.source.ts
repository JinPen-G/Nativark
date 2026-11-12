/** Current trusted deployment publication for human review metadata only.
 * Re-read ConfigService on every check; an enabled grant row or successful
 * historical read cannot substitute for the current policy or renew its TTL. */
import type { ConfigService } from '@nestjs/config';
import { readRuntimePublication } from '../runtime-publication.configuration';
import type { HumanAutomationReviewGrantPolicySource } from './human-automation-review-grant.service';
import type { HumanAutomationReviewGrantTarget } from './human-automation-review.service';

export class RuntimeAutomationReviewGrantPolicySource implements HumanAutomationReviewGrantPolicySource {
  constructor(private readonly configuration: Pick<ConfigService, 'get'>) {}

  async read(_target: HumanAutomationReviewGrantTarget): Promise<unknown> {
    const publication = readRuntimePublication(this.configuration);
    return publication.configurations.automationReviewGrant ?? { enabled: false };
  }
}
