import type { FactoryProvider } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ApiAuthGuard } from '../../common/api-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { RentalCoreService } from '../rental-core/rental-core.service';
import { RentalBusinessService } from '../rental-core/rental-business.service';
import { RentalWorkspaceReportRepository } from '../rental-core/rental-workspace-report.repository';
import { MembershipService } from '../platform/membership.service';
import { PaymentRuntimeService } from '../integrations/payment.runtime.service';
import { ClientApiService } from '../client/client-api.service';
import { composeStandardClientBookingEntry, AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY } from './scenes/standard-client-entry.application';
import { composeRequestBoundOriginalScenes } from './scenes/request-bound-scenes.application';
import { AI_ORIGINAL_SCENE_REQUESTS } from './scenes/original-scenes.controller';
import { StaffInspectionRequestFactory } from './inspection-assist/inspection-assist.composition';
import { AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_ENABLED,
  AI_STAFF_INSPECTION_OPERATIONS } from './inspection-assist/staff-inspection-assist.controller';

export const AI_NATIVE_CLIENT_ENTRY_PROVIDERS: FactoryProvider[] = ([
  [AI_WEBSITE_ENTRY, 'web'], [AI_WECHAT_ENTRY, 'wechat_miniprogram'],
] as const).map(([provide, channel]) => ({
  provide, inject: [PrismaService, ApiAuthGuard, SubscriptionService, ClientApiService],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, subscriptions: SubscriptionService, client: ClientApiService) =>
    composeStandardClientBookingEntry({ db, guard, client,
      tasks: { db, subscriptions, sceneCode: 'quote_clarification', sceneVersion: '1' },
      quotePreparation: client, bookingSubmission: client }, channel),
}));

/** Historical observations only. No storage reader, recognition driver or Core
 * submission port is supplied; normal staff pages can reopen owned history,
 * but cannot use this registration to create drafts or execute inspections. */
export const AI_NATIVE_STAFF_RECEIPT_PROVIDERS: FactoryProvider[] = [{
  provide: AI_STAFF_INSPECTION_REQUESTS,
  inject: [PrismaService, ApiAuthGuard, RentalCoreService],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, core: RentalCoreService) =>
    new StaffInspectionRequestFactory({ db, guard, core })
}, {
  provide: AI_STAFF_INSPECTION_ENABLED, useFactory: () => true
}, {
  provide: AI_STAFF_INSPECTION_OPERATIONS,
  useFactory: () => Object.freeze(['history-read', 'receipt-host-read', 'result-save-receipt'])
}];

/** Standard application wiring, not an execution enable switch. No startup
 * reads, policies, credentials, worker, model adapter or financial ledger are
 * created here. Every request uses its own current Guard/Auth/ALS context.
 * Missing/disabled persisted scene policy or AI entitlement refuses creation.
 * Only the existing order-fact preparation is selected for this first host;
 * model execution and business writes have no registered driver in this graph.
 */
export const AI_NATIVE_ORIGINAL_REQUEST_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_SCENE_REQUESTS,
  inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, RentalCoreService,
    RentalBusinessService, RentalWorkspaceReportRepository, MembershipService, PaymentRuntimeService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService) => composeRequestBoundOriginalScenes({
      db, auth, guard, subscriptions, core, business, reports, memberships, payments,
      creationRules: [{ sceneCode: 'order_explanation', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:view'], maxInputAgeMs: 300000 }]
    }, { enabled: true, audience: 'operator' })
};
