/** Rental HTTP 的统一装配入口，复用原 Controller、应用令牌和可选依赖语义。
 * 宿主提供同一业务服务、数据库及当前身份/Guard；本模块不创建领域服务、计时器或迁移。
 * 完整模块与单独品类模块二选一，避免重复登记同一 Controller。 */
import { RENTAL_HTTP_SERVICE_TOKENS } from "./http-assembly";
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
import { StaffAuthController, type RentalStaffAuthHttpApplication } from "./http-staff-auth.controller";
import { StaffUploadsController, type RentalStaffUploadsDatabase, type RentalStaffUploadsStorage, type RentalStaffUploadObservationParser, type RentalStaffInspectionEvidence } from "./http-staff-uploads.controller";
import * as rental from "./http-applications";
import { type RentalEnterpriseHttpApplications } from "./http-enterprise-applications";
import { type RentalClientHttpApplications } from "./http-client-applications";
import { type RentalCategoryHttpApplications } from "./http-category-applications";
import { type RentalClientChannelHttpApplication, type RentalWebsiteChannelHttpApplication, type RentalWebsiteAssetHttpApplication, type RentalMiniProgramChannelHttpApplication } from "./http-channel-applications";
import { type RentalMembershipHttpApplication, type RentalEnterprisePortalHttpApplication } from "./http-membership-applications";
import { type RentalCustomerAvatarHttpApplication } from "./http-customer-avatar-applications";
import { type RentalFileLedgerHttpApplication, type RentalFileStorageHttpApplication, type RentalFileHttpDatabase, type RentalFileCustomerHttpAuthority } from "./http-file-applications";


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
  ...bind("rental", RENTAL_HTTP_SERVICE_TOKENS.rental, services => services.rental,
    ["corporateSettlement", "memberships", "failureEvents", "exchangePreview", "exchangeInspections", "exchangeInspectionMedia"]),
  ...bind("enterprise", RENTAL_HTTP_SERVICE_TOKENS.enterprise, services => services.enterprise),
  ...bind("client", RENTAL_HTTP_SERVICE_TOKENS.client, services => services.client),
  ...bind("category", RENTAL_HTTP_SERVICE_TOKENS.category, services => services.category),
  ...bind("channels", RENTAL_HTTP_SERVICE_TOKENS.channels, services => services.channels),
  ...bind("members", RENTAL_HTTP_SERVICE_TOKENS.members, services => services.members, ["enterprisePortal"]),
  ...bind("files", RENTAL_HTTP_SERVICE_TOKENS.files, services => services.files),
  ...bind("staff", RENTAL_HTTP_SERVICE_TOKENS.staff, services => services.staff, ["inspectionEvidence"]),
  ...bind("customer", RENTAL_HTTP_SERVICE_TOKENS.customer, services => ({ avatar: services.customerAvatar })),
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

export { composeRentalHttpServiceGroups, RENTAL_HTTP_DEPENDENCY_TOKENS } from "./http-assembly";
