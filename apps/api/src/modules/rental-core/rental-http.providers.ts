/** 原Rental HTTP宿主接线。类型核对实际实例，useExisting不创建第二个业务服务或数据源。 */
import type { Provider, Type } from "@nestjs/common";
import {
  RENTAL_HTTP_CORE, RENTAL_HTTP_BUSINESS, RENTAL_HTTP_ALLOCATION, RENTAL_HTTP_ORDER_CONFIRMATION,
  RENTAL_HTTP_IDEMPOTENT, RENTAL_HTTP_REPORTS, RENTAL_HTTP_DATABASE, RENTAL_HTTP_SERVICE_CAPACITIES,
  RENTAL_HTTP_FUNDING, RENTAL_HTTP_DOCUMENTS, RENTAL_HTTP_OPERATION_LOGS, RENTAL_HTTP_CORPORATE_SETTLEMENT,
  RENTAL_HTTP_MEMBERSHIPS, RENTAL_HTTP_FAILURE_EVENTS, RENTAL_HTTP_EXCHANGE_PREVIEW,
  RENTAL_HTTP_EXCHANGE_INSPECTIONS, RENTAL_HTTP_EXCHANGE_INSPECTION_MEDIA, RENTAL_HTTP_OFFICIAL_CALENDAR_SOURCES,
  type RentalHttpApplications
} from "@rental-os/rental-core/http-applications";
import { RENTAL_WORKSPACE_CAPABILITIES_APPLICATION, RENTAL_STAFF_PAYMENTS_APPLICATION } from "@rental-os/rental-core/http-service-ports";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { MembershipService } from "../platform/membership.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalAllocationService } from "./rental-allocation.service";
import { RentalOrderConfirmationService } from "./rental-order-confirmation.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { RentalWorkspaceReportRepository } from "./rental-workspace-report.repository";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalDocumentService } from "./rental-document.service";
import { RentalExchangePreviewService } from "./rental-exchange-preview.service";
import { RentalExchangeInspectionPreparationService } from "./rental-exchange-inspection-preparation.service";
import { RentalExchangeInspectionMediaService } from "./rental-exchange-inspection-media.service";
import { OFFICIAL_CALENDAR_SOURCE_READER } from "@rental-os/platform-server/official-calendar-reader";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { StaffOfflinePaymentService } from "./staff-offline-payment.service";

function existing<T>(token: symbol, source: Type<T>): Provider {
  return { provide: token, useExisting: source };
}

export const RENTAL_HTTP_PROVIDERS: Provider[] = [
  existing<RentalHttpApplications["core"]>(RENTAL_HTTP_CORE, RentalCoreService),
  existing<RentalHttpApplications["business"]>(RENTAL_HTTP_BUSINESS, RentalBusinessService),
  existing<RentalHttpApplications["allocation"]>(RENTAL_HTTP_ALLOCATION, RentalAllocationService),
  existing<RentalHttpApplications["orderConfirmation"]>(RENTAL_HTTP_ORDER_CONFIRMATION, RentalOrderConfirmationService),
  existing<RentalHttpApplications["idempotent"]>(RENTAL_HTTP_IDEMPOTENT, RentalIdempotentActionService),
  existing<RentalHttpApplications["reports"]>(RENTAL_HTTP_REPORTS, RentalWorkspaceReportRepository),
  existing<RentalHttpApplications["database"]>(RENTAL_HTTP_DATABASE, PrismaService),
  existing<RentalHttpApplications["serviceCapacities"]>(RENTAL_HTTP_SERVICE_CAPACITIES, RentalServiceCapacityService),
  existing<RentalHttpApplications["funding"]>(RENTAL_HTTP_FUNDING, RentalFundingService),
  existing<RentalHttpApplications["documents"]>(RENTAL_HTTP_DOCUMENTS, RentalDocumentService),
  existing<RentalHttpApplications["operationLogs"]>(RENTAL_HTTP_OPERATION_LOGS, OperationLogService),
  existing<NonNullable<RentalHttpApplications["corporateSettlement"]>>(RENTAL_HTTP_CORPORATE_SETTLEMENT, CustomerCorporateSettlementService),
  existing<NonNullable<RentalHttpApplications["memberships"]>>(RENTAL_HTTP_MEMBERSHIPS, MembershipService),
  existing<NonNullable<RentalHttpApplications["exchangePreview"]>>(RENTAL_HTTP_EXCHANGE_PREVIEW, RentalExchangePreviewService),
  existing<NonNullable<RentalHttpApplications["exchangeInspections"]>>(RENTAL_HTTP_EXCHANGE_INSPECTIONS, RentalExchangeInspectionPreparationService),
  existing<NonNullable<RentalHttpApplications["exchangeInspectionMedia"]>>(RENTAL_HTTP_EXCHANGE_INSPECTION_MEDIA, RentalExchangeInspectionMediaService),
  { provide: RENTAL_HTTP_OFFICIAL_CALENDAR_SOURCES, useExisting: OFFICIAL_CALENDAR_SOURCE_READER },
  existing<RentalHttpApplications["workspaceCapabilities"]>(RENTAL_WORKSPACE_CAPABILITIES_APPLICATION, WorkspaceCapabilityService),
  existing<RentalHttpApplications["staffPayments"]>(RENTAL_STAFF_PAYMENTS_APPLICATION, StaffOfflinePaymentService),
  {
    provide: RENTAL_HTTP_FAILURE_EVENTS,
    inject: [{ token: BUSINESS_FAILURE_OUTBOX, optional: true }],
    // 仅投影实际检查方法，不把原出箱对象的生命周期钩子再次登记。
    useFactory: (events?: BusinessFailureOutboxParticipant): RentalHttpApplications["failureEvents"] =>
      events?.inspection ? { inspection: events.inspection.bind(events) } : undefined
  }
];
