import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AuthService } from '../../auth/auth.service';
import type { PrismaService } from '../../database/prisma.service';
import { PaymentRuntimeService } from '../../integrations/payment.runtime.service';
import type { TenantIntegrationService } from '../../integrations/tenant-integration.service';
import { RentalBusinessFactRepository } from '../../rental-core/rental-business-fact.repository';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { RentalFundingService } from '../../rental-core/rental-funding.service';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { BusinessFailureCandidateService } from './business-failure-candidate.service';
import { BusinessFailureReadAuthority } from './business-failure-read.authority';
import { AutomationFailureTasksModule, composeAutomationFailureTasks, type AutomationDependencies } from '../automation/automation.composition';
import { HumanAutomationPolicyManagementService } from '../automation/human-automation-policy-management.service';
import { HumanAutomationReviewService } from '../automation/human-automation-review.service';
import { BUSINESS_FAILURE_OUTBOX, PrismaBusinessFailureOutbox } from './prisma-business-failure-outbox';

export type BusinessFailureDependencies = {
  db: PrismaService; integrations: TenantIntegrationService; funding: RentalFundingService;
  core: Pick<RentalCoreService, 'getOrder'>; auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiTaskCredentialSource;
  clock?: () => Date;
};

export function composeBusinessFailureEvents(input: BusinessFailureDependencies) {
  const outbox = new PrismaBusinessFailureOutbox(input.clock);
  const authority = new BusinessFailureReadAuthority(input.db, input.auth, input.credentials, input.guard, input.core, input.clock);
  return { outbox, notifications: new RentalBusinessFactRepository(input.db, outbox),
    payments: new PaymentRuntimeService(input.db, input.integrations, input.funding, outbox),
    candidates: new BusinessFailureCandidateService(input.db, authority, input.clock),
    reviews: new HumanAutomationReviewService(input.db, authority, input.clock),
    policyManagement: new HumanAutomationPolicyManagementService(input.db, input, input.clock) };
}

export function composeBusinessFailureAutomation(input: BusinessFailureDependencies & Pick<AutomationDependencies, 'policyId' | 'subscriptions'>) {
  return { ...composeBusinessFailureEvents(input), automation: composeAutomationFailureTasks(input) };
}

@Module({})
export class BusinessFailureEventsModule {
  static registerAutomation(input: BusinessFailureDependencies & Pick<AutomationDependencies, 'policyId' | 'subscriptions'>): DynamicModule {
    const base = this.register(input);
    return { ...base, imports: [AutomationFailureTasksModule.register(input)], exports: [...(base.exports ?? []), AutomationFailureTasksModule] };
  }
  static register(input: BusinessFailureDependencies): DynamicModule {
    const services = composeBusinessFailureEvents(input);
    return { module: BusinessFailureEventsModule, providers: [
      { provide: BUSINESS_FAILURE_OUTBOX, useValue: services.outbox },
      { provide: RentalBusinessFactRepository, useValue: services.notifications },
      { provide: PaymentRuntimeService, useValue: services.payments },
      { provide: BusinessFailureCandidateService, useValue: services.candidates },
      { provide: HumanAutomationReviewService, useValue: services.reviews },
      { provide: HumanAutomationPolicyManagementService, useValue: services.policyManagement }
    ], exports: [BUSINESS_FAILURE_OUTBOX, RentalBusinessFactRepository, PaymentRuntimeService, BusinessFailureCandidateService, HumanAutomationReviewService, HumanAutomationPolicyManagementService] };
  }
}
