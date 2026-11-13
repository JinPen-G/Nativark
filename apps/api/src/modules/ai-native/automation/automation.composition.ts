import { Module, type DynamicModule } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { SubscriptionBudgetEntitlementAdapter } from '../budget/budget-dependency-adapters';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { AutomationError, PrismaAutomationAuthority } from './prisma-automation.authority';
import { AutomationFailureTaskService } from './automation-failure-task.service';
import type { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';

export type AutomationDependencies = {
  db: PrismaClient;
  policyId: string;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  clock?: () => Date;
  /** Trusted selection recheck inside the original event/preparation transaction. */
  assertPreparationPolicy?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export function composeAutomationFailureTasks(input: AutomationDependencies, humanReads?: BusinessFailureReadAuthority) {
  if (typeof input?.db?.$transaction !== 'function' || typeof input.db.aiAutomationInput?.create !== 'function'
    || typeof input.db.aiAutomationSubject?.findFirst !== 'function' || typeof input.db.aiAutomationPolicy?.findUnique !== 'function'
    || typeof input.subscriptions?.readCategoryCommercialContext !== 'function'
    || input.assertPreparationPolicy !== undefined && typeof input.assertPreparationPolicy !== 'function') throw new AutomationError('unavailable');
  const clock = input.clock ?? (() => new Date());
  const entitlements = new SubscriptionBudgetEntitlementAdapter(new PrismaSubscriptionBudgetReader(input.db, input.subscriptions, clock));
  const authority = new PrismaAutomationAuthority(input.db, input.policyId, entitlements, clock, humanReads);
  return new AutomationFailureTaskService(input.db, authority, new AiTaskCreationRepository(input.db, authority, clock), clock,
    input.assertPreparationPolicy);
}

@Module({})
export class AutomationFailureTasksModule {
  static register(input: AutomationDependencies, humanReads?: BusinessFailureReadAuthority): DynamicModule {
    return { module: AutomationFailureTasksModule,
      providers: [{ provide: AutomationFailureTaskService, useValue: composeAutomationFailureTasks(input, humanReads) }], exports: [AutomationFailureTaskService] };
  }
}
