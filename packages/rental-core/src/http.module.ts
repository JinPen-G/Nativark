/** Rental HTTP 的统一装配入口，复用原 Controller、应用令牌和可选依赖语义。
 * 宿主提供同一业务服务、数据库及当前身份/Guard；本模块不创建领域服务、计时器或迁移。
 * 完整模块与单独品类模块二选一，避免重复登记同一 Controller。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { RentalCoreController } from "./http-core.controller";
import { RentalBusinessController } from "./http-business.controller";
import { WorkspaceCapabilityController } from "./http-workspace-capabilities.controller";
import { StaffOfflinePaymentController } from "./http-staff-payments.controller";
import { CategoryGovernanceController } from "./http-category-governance.controller";
import { CategoryAdoptionPreparationController } from "./http-category-adoption-preparation.controller";
import { CategoryGovernancePreviewGuard } from "./http-category-preview.guard";
import { EnterpriseWorkflowsController } from "./http-enterprise-workflows.controller";
import { EnterpriseReadController } from "./http-enterprise-read.controller";
import { EnterpriseMerchantController } from "./http-enterprise-merchant.controller";
import { EnterpriseRentalHandoffMerchantController } from "./http-enterprise-handoff-merchant.controller";
import { ClientApiController } from "./http-client.controller";
import { ClientChannelProfileController, MiniProgramChannelController, WebsiteChannelProfileController } from "./http-channels.controller";
import { MembershipController } from "./http-membership.controller";
import { CustomerAvatarController } from "./http-customer-avatar.controller";
import { FilesController } from "./http-files.controller";
import { StaffAuthController, RENTAL_STAFF_AUTH_APPLICATION, type RentalStaffAuthHttpApplication } from "./http-staff-auth.controller";
import { StaffUploadsController, RENTAL_STAFF_UPLOADS_DATABASE, RENTAL_STAFF_UPLOADS_STORAGE,
  RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER, RENTAL_STAFF_INSPECTION_EVIDENCE,
  type RentalStaffUploadsDatabase, type RentalStaffUploadsStorage, type RentalStaffUploadObservationParser,
  type RentalStaffInspectionEvidence } from "./http-staff-uploads.controller";
import * as rental from "./http-applications";
import { RENTAL_ENTERPRISE_HTTP, type RentalEnterpriseHttpApplications } from "./http-enterprise-applications";
import { RENTAL_CLIENT_HTTP, type RentalClientHttpApplications } from "./http-client-applications";
import { RENTAL_HTTP_CATEGORY_GOVERNANCE, RENTAL_HTTP_CATEGORY_PREPARATIONS, RENTAL_HTTP_CATEGORY_ADOPTIONS,
  type RentalCategoryHttpApplications } from "./http-category-applications";
import { RENTAL_CLIENT_CHANNEL_APPLICATION, RENTAL_WEBSITE_CHANNEL_APPLICATION, RENTAL_WEBSITE_ASSET_APPLICATION,
  RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION, type RentalClientChannelHttpApplication,
  type RentalWebsiteChannelHttpApplication, type RentalWebsiteAssetHttpApplication,
  type RentalMiniProgramChannelHttpApplication } from "./http-channel-applications";
import { RENTAL_MEMBERSHIP_APPLICATION, RENTAL_ENTERPRISE_PORTAL_APPLICATION,
  type RentalMembershipHttpApplication, type RentalEnterprisePortalHttpApplication } from "./http-membership-applications";
import { RENTAL_CUSTOMER_AVATAR_APPLICATION, type RentalCustomerAvatarHttpApplication } from "./http-customer-avatar-applications";
import { RENTAL_FILES_LEDGER, RENTAL_FILES_STORAGE, RENTAL_FILES_DATABASE, RENTAL_FILES_CUSTOMER_AUTHORITY,
  type RentalFileLedgerHttpApplication, type RentalFileStorageHttpApplication, type RentalFileHttpDatabase,
  type RentalFileCustomerHttpAuthority } from "./http-file-applications";
import { RENTAL_WORKSPACE_CAPABILITIES_APPLICATION, RENTAL_STAFF_PAYMENTS_APPLICATION } from "./http-service-ports";

export interface RentalHttpServiceGroups {
  rental: rental.RentalHttpApplications;
  enterprise: RentalEnterpriseHttpApplications;
  client: RentalClientHttpApplications;
  category: RentalCategoryHttpApplications;
  channels: {
    client: RentalClientChannelHttpApplication;
    website: RentalWebsiteChannelHttpApplication;
    assets: RentalWebsiteAssetHttpApplication;
    miniProgram: RentalMiniProgramChannelHttpApplication;
  };
  members: {
    membership: RentalMembershipHttpApplication;
    enterprisePortal?: RentalEnterprisePortalHttpApplication;
  };
  files: {
    ledger: RentalFileLedgerHttpApplication;
    storage: RentalFileStorageHttpApplication;
    database: RentalFileHttpDatabase;
    customerAuthority: RentalFileCustomerHttpAuthority;
  };
  staff: {
    auth: RentalStaffAuthHttpApplication;
    database: RentalStaffUploadsDatabase;
    storage: RentalStaffUploadsStorage;
    observe: RentalStaffUploadObservationParser;
    inspectionEvidence?: RentalStaffInspectionEvidence;
  };
  customerAvatar: RentalCustomerAvatarHttpApplication;
}

export interface RentalHttpRegistration
  extends Pick<FactoryProvider<RentalHttpServiceGroups>, "inject" | "useFactory"> {
  imports?: ModuleMetadata["imports"];
}

// 同一原类供旧宿主、完整模块及接口资料消费；应用服务只有宿主供给的一份实例。
export const RENTAL_HTTP_CONTROLLERS = [
  StaffAuthController, CategoryGovernanceController, CategoryAdoptionPreparationController,
  MembershipController, EnterpriseWorkflowsController, EnterpriseReadController, EnterpriseMerchantController,
  EnterpriseRentalHandoffMerchantController, CustomerAvatarController, RentalCoreController, RentalBusinessController,
  WorkspaceCapabilityController, FilesController, StaffUploadsController, StaffOfflinePaymentController,
  ClientApiController, MiniProgramChannelController, ClientChannelProfileController, WebsiteChannelProfileController,
];

type TokenMap<T> = { readonly [K in keyof T]-?: symbol };
const APPLICATIONS = Symbol("rental.http.applications");
const rentalTokens: TokenMap<rental.RentalHttpApplications> = {
  core: rental.RENTAL_HTTP_CORE,
  business: rental.RENTAL_HTTP_BUSINESS,
  allocation: rental.RENTAL_HTTP_ALLOCATION,
  orderConfirmation: rental.RENTAL_HTTP_ORDER_CONFIRMATION,
  idempotent: rental.RENTAL_HTTP_IDEMPOTENT,
  reports: rental.RENTAL_HTTP_REPORTS,
  database: rental.RENTAL_HTTP_DATABASE,
  serviceCapacities: rental.RENTAL_HTTP_SERVICE_CAPACITIES,
  funding: rental.RENTAL_HTTP_FUNDING,
  documents: rental.RENTAL_HTTP_DOCUMENTS,
  operationLogs: rental.RENTAL_HTTP_OPERATION_LOGS,
  corporateSettlement: rental.RENTAL_HTTP_CORPORATE_SETTLEMENT,
  memberships: rental.RENTAL_HTTP_MEMBERSHIPS,
  failureEvents: rental.RENTAL_HTTP_FAILURE_EVENTS,
  exchangePreview: rental.RENTAL_HTTP_EXCHANGE_PREVIEW,
  exchangeInspections: rental.RENTAL_HTTP_EXCHANGE_INSPECTIONS,
  exchangeInspectionMedia: rental.RENTAL_HTTP_EXCHANGE_INSPECTION_MEDIA,
  officialCalendarSources: rental.RENTAL_HTTP_OFFICIAL_CALENDAR_SOURCES,
  workspaceCapabilities: RENTAL_WORKSPACE_CAPABILITIES_APPLICATION,
  staffPayments: RENTAL_STAFF_PAYMENTS_APPLICATION,
};

function bind<T>(group: string, tokens: TokenMap<T>, select: (services: RentalHttpServiceGroups) => T,
  optional: readonly (keyof T)[] = []): FactoryProvider[] {
  return (Object.keys(tokens) as Array<keyof T>).map(key => ({
    provide: tokens[key], inject: [APPLICATIONS],
    useFactory: (services: RentalHttpServiceGroups) => {
      const application = select(services)[key];
      if (application == null && !optional.includes(key)) throw new Error(`缺少Rental HTTP应用：${group}.${String(key)}`);
      return application;
    },
  }));
}

const applicationProviders = [
  ...bind("rental", rentalTokens, services => services.rental,
    ["corporateSettlement", "memberships", "failureEvents", "exchangePreview", "exchangeInspections", "exchangeInspectionMedia"]),
  ...bind("enterprise", RENTAL_ENTERPRISE_HTTP, services => services.enterprise),
  ...bind("client", RENTAL_CLIENT_HTTP, services => services.client),
  ...bind("category", {
    governance: RENTAL_HTTP_CATEGORY_GOVERNANCE,
    preparations: RENTAL_HTTP_CATEGORY_PREPARATIONS,
    adoptions: RENTAL_HTTP_CATEGORY_ADOPTIONS,
  }, services => services.category),
  ...bind("channels", {
    client: RENTAL_CLIENT_CHANNEL_APPLICATION,
    website: RENTAL_WEBSITE_CHANNEL_APPLICATION,
    assets: RENTAL_WEBSITE_ASSET_APPLICATION,
    miniProgram: RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION,
  }, services => services.channels),
  ...bind("members", {
    membership: RENTAL_MEMBERSHIP_APPLICATION,
    enterprisePortal: RENTAL_ENTERPRISE_PORTAL_APPLICATION,
  }, services => services.members, ["enterprisePortal"]),
  ...bind("files", {
    ledger: RENTAL_FILES_LEDGER,
    storage: RENTAL_FILES_STORAGE,
    database: RENTAL_FILES_DATABASE,
    customerAuthority: RENTAL_FILES_CUSTOMER_AUTHORITY,
  }, services => services.files),
  ...bind("staff", {
    auth: RENTAL_STAFF_AUTH_APPLICATION,
    database: RENTAL_STAFF_UPLOADS_DATABASE,
    storage: RENTAL_STAFF_UPLOADS_STORAGE,
    observe: RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER,
    inspectionEvidence: RENTAL_STAFF_INSPECTION_EVIDENCE,
  }, services => services.staff, ["inspectionEvidence"]),
  ...bind("customer", { avatar: RENTAL_CUSTOMER_AVATAR_APPLICATION }, services => ({ avatar: services.customerAvatar })),
];

@Module({})
export class RentalHttpModule {
  static register(services: RentalHttpServiceGroups): DynamicModule {
    return this.registerFactory({ useFactory: () => services });
  }

  static registerFactory(options: RentalHttpRegistration): DynamicModule {
    return {
      module: RentalHttpModule,
      imports: options.imports,
      controllers: RENTAL_HTTP_CONTROLLERS,
      providers: [
        { provide: APPLICATIONS, inject: options.inject, useFactory: options.useFactory },
        ...applicationProviders,
        CategoryGovernancePreviewGuard,
      ],
      exports: applicationProviders.map(provider => provider.provide),
    };
  }
}

export {
  StaffAuthController, CategoryGovernanceController, CategoryAdoptionPreparationController,
  MembershipController, EnterpriseWorkflowsController, EnterpriseReadController, EnterpriseMerchantController,
  EnterpriseRentalHandoffMerchantController, CustomerAvatarController, RentalCoreController, RentalBusinessController,
  WorkspaceCapabilityController, FilesController, StaffUploadsController, StaffOfflinePaymentController,
  ClientApiController, MiniProgramChannelController, ClientChannelProfileController, WebsiteChannelProfileController,
};
