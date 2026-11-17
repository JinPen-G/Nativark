/** Rental HTTP的私有应用接点。宿主提供同一实际服务与MySQL事务，不因此取得业务权限。
 * 生成模型只用于该适配，领域根出口与公共Core合同不加载此文件。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
import type {
  BookingMemberOption, CustomerMembershipBookingOption,
  OfficialCalendarSourceVersion, OfficialCalendarSourceVersionSummary
} from "./contracts";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalAllocationService } from "./mysql-allocation";
import type { RentalOrderConfirmationService } from "./mysql-order-confirmation";
import type { RentalIdempotentActionService } from "./mysql-idempotent-actions";
import type { RentalWorkspaceReportRepository } from "./mysql-reports";
import type { RentalServiceCapacityService } from "./mysql-service-capacity";
import type { RentalFundingService } from "./mysql-funding";
import type { RentalDocumentService } from "./mysql-documents";
import type { RentalExchangePreviewService } from "./mysql-exchange-preview";
import type { RentalExchangeInspectionPreparationService } from "./mysql-exchange-inspection-preparation";
import type { RentalExchangeInspectionMediaService } from "./mysql-exchange-inspection-media";
import type { RentalWorkspaceCapabilitiesHttpApplication, RentalStaffPaymentsHttpApplication } from "./http-service-ports";

type PublicMethods<T> = Pick<T, keyof T>;
export type RentalHttpDatabase = Pick<PrismaClient, "fileAsset" | "rentalCarrierShipmentEvent" | "$transaction"
  | "rentalOfflinePaymentRegistration" | "operationLog" | "rentalInspectionRecord" | "businessWorkspace">;

export interface RentalHttpMembershipOptions {
  listPersonalOptions(tenantId: string): Promise<BookingMemberOption[]>;
  listBookingOptions(tenantId: string, workspaceId: string, personalCustomerId: string,
    page?: { limit: number; cursor?: string }): Promise<CustomerMembershipBookingOption[]>;
}

/** 企业结算仍由原业务域核当前主体、授信、资金和冻结快照；HTTP只委托本链需要的方法。 */
export interface RentalHttpCorporateSettlement {
  settleCancelledOrderCredit(tenantId: string, orderId: string, reason: string, transaction: Prisma.TransactionClient, operator?: string): Promise<unknown>;
  requiresCreditSettlement(tenantId: string, orderId: string, transaction?: Prisma.TransactionClient): Promise<boolean>;
  freezeOrderSettlement(tenantId: string, orderId: string, transaction: Prisma.TransactionClient): Promise<boolean>;
  reserveOrderCredit(tenantId: string, orderId: string, transaction: Prisma.TransactionClient, operator?: string): Promise<unknown>;
  allowsExtensionCredit(tenantId: string, orderId: string, transaction?: Prisma.TransactionClient): Promise<boolean>;
  reserveOrderChangeCredit(tenantId: string, orderId: string, changeId: string, amount: number, transaction: Prisma.TransactionClient, operator?: string): Promise<unknown>;
  assertReadyForPickup(tenantId: string, orderId: string, transaction: Prisma.TransactionClient): Promise<unknown>;
  settleOrderCredit(tenantId: string, orderId: string, transaction: Prisma.TransactionClient, operator?: string): Promise<unknown>;
}

/** 读取原公共来源版本；来源维护与发布权不进入Rental。 */
export interface RentalHttpOfficialCalendarSources {
  findVersionById(id: string): Promise<OfficialCalendarSourceVersion | undefined>;
  latestVersionForYear(year: number, sourceId: string): Promise<Pick<OfficialCalendarSourceVersion, "id" | "version"> | undefined>;
  availableSourceSummaryForYear(year: number): Promise<{ available: number; total: number }>;
  getApplicableVersion(id: string): Promise<OfficialCalendarSourceVersion>;
  listVersions(sourceId?: string, year?: number, activeOnly?: boolean): Promise<OfficialCalendarSourceVersionSummary[]>;
}

/** 只有原事务已确认的检查事实进入原出箱；缺处理器沿原业务不可用/恢复规则处理。 */
export interface RentalHttpInspectionFailureEvents {
  inspection?(transaction: Prisma.TransactionClient, scope: { tenantId: string; workspaceId: string }, id: string): Promise<void>;
}

export interface RentalHttpApplications {
  core: PublicMethods<RentalCoreService<Prisma.TransactionClient>>;
  business: PublicMethods<RentalBusinessService<Prisma.TransactionClient>>;
  allocation: PublicMethods<RentalAllocationService<Prisma.TransactionClient>>;
  orderConfirmation: PublicMethods<RentalOrderConfirmationService<Prisma.TransactionClient>>;
  idempotent: PublicMethods<RentalIdempotentActionService<Prisma.TransactionClient>>;
  reports: Pick<RentalWorkspaceReportRepository, "getOperationReport">;
  database: RentalHttpDatabase;
  serviceCapacities: PublicMethods<RentalServiceCapacityService<Prisma.TransactionClient>>;
  funding: PublicMethods<RentalFundingService<Prisma.TransactionClient>>;
  documents: Pick<RentalDocumentService, "render" | "listSnapshots" | "readSnapshot">;
  operationLogs: Pick<PlatformOperationLogService, "record">;
  corporateSettlement?: RentalHttpCorporateSettlement;
  memberships?: RentalHttpMembershipOptions;
  failureEvents?: RentalHttpInspectionFailureEvents;
  exchangePreview?: Pick<RentalExchangePreviewService<Prisma.TransactionClient>, "preview">;
  exchangeInspections?: PublicMethods<RentalExchangeInspectionPreparationService<Prisma.TransactionClient>>;
  exchangeInspectionMedia?: PublicMethods<RentalExchangeInspectionMediaService<Prisma.TransactionClient>>;
  officialCalendarSources: RentalHttpOfficialCalendarSources;
  workspaceCapabilities: RentalWorkspaceCapabilitiesHttpApplication;
  staffPayments: RentalStaffPaymentsHttpApplication;
}

export const RENTAL_HTTP_CORE = Symbol("rental.http.core");
export const RENTAL_HTTP_BUSINESS = Symbol("rental.http.business");
export const RENTAL_HTTP_ALLOCATION = Symbol("rental.http.allocation");
export const RENTAL_HTTP_ORDER_CONFIRMATION = Symbol("rental.http.order-confirmation");
export const RENTAL_HTTP_IDEMPOTENT = Symbol("rental.http.idempotent");
export const RENTAL_HTTP_REPORTS = Symbol("rental.http.reports");
export const RENTAL_HTTP_DATABASE = Symbol("rental.http.database");
export const RENTAL_HTTP_SERVICE_CAPACITIES = Symbol("rental.http.service-capacities");
export const RENTAL_HTTP_FUNDING = Symbol("rental.http.funding");
export const RENTAL_HTTP_DOCUMENTS = Symbol("rental.http.documents");
export const RENTAL_HTTP_OPERATION_LOGS = Symbol("rental.http.operation-logs");
export const RENTAL_HTTP_CORPORATE_SETTLEMENT = Symbol("rental.http.corporate-settlement");
export const RENTAL_HTTP_MEMBERSHIPS = Symbol("rental.http.memberships");
export const RENTAL_HTTP_FAILURE_EVENTS = Symbol("rental.http.failure-events");
export const RENTAL_HTTP_EXCHANGE_PREVIEW = Symbol("rental.http.exchange-preview");
export const RENTAL_HTTP_EXCHANGE_INSPECTIONS = Symbol("rental.http.exchange-inspections");
export const RENTAL_HTTP_EXCHANGE_INSPECTION_MEDIA = Symbol("rental.http.exchange-inspection-media");
export const RENTAL_HTTP_OFFICIAL_CALENDAR_SOURCES = Symbol("rental.http.official-calendar-sources");
