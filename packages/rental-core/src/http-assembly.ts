/** 把可信宿主的现有服务令牌组合成同一 Rental HTTP 应用。
 * 只解析依赖，不创建服务、授予权限或执行生命周期；必需依赖仍由 HTTP 模块核定。 */
import type { RentalHttpServiceGroups } from "./http.module";
import * as rental from "./http-applications";
import { RENTAL_ENTERPRISE_HTTP } from "./http-enterprise-applications";
import { RENTAL_CLIENT_HTTP } from "./http-client-applications";
import { RENTAL_HTTP_CATEGORY_GOVERNANCE, RENTAL_HTTP_CATEGORY_PREPARATIONS,
  RENTAL_HTTP_CATEGORY_ADOPTIONS } from "./http-category-applications";
import { RENTAL_CLIENT_CHANNEL_APPLICATION, RENTAL_WEBSITE_CHANNEL_APPLICATION,
  RENTAL_WEBSITE_ASSET_APPLICATION, RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION } from "./http-channel-applications";
import { RENTAL_MEMBERSHIP_APPLICATION, RENTAL_ENTERPRISE_PORTAL_APPLICATION } from "./http-membership-applications";
import { RENTAL_CUSTOMER_AVATAR_APPLICATION } from "./http-customer-avatar-applications";
import { RENTAL_FILES_LEDGER, RENTAL_FILES_STORAGE, RENTAL_FILES_DATABASE,
  RENTAL_FILES_CUSTOMER_AUTHORITY } from "./http-file-applications";
import { RENTAL_WORKSPACE_CAPABILITIES_APPLICATION, RENTAL_STAFF_PAYMENTS_APPLICATION } from "./http-service-ports";
import { RENTAL_STAFF_AUTH_APPLICATION } from "./http-staff-auth.controller";
import { RENTAL_STAFF_UPLOADS_DATABASE, RENTAL_STAFF_UPLOADS_STORAGE,
  RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER, RENTAL_STAFF_INSPECTION_EVIDENCE } from "./http-staff-uploads.controller";

type Tokens<T> = { readonly [K in keyof T]-?: symbol };
export const RENTAL_HTTP_SERVICE_TOKENS = {
  rental: {
    core: rental.RENTAL_HTTP_CORE, business: rental.RENTAL_HTTP_BUSINESS,
    allocation: rental.RENTAL_HTTP_ALLOCATION, orderConfirmation: rental.RENTAL_HTTP_ORDER_CONFIRMATION,
    idempotent: rental.RENTAL_HTTP_IDEMPOTENT, reports: rental.RENTAL_HTTP_REPORTS,
    database: rental.RENTAL_HTTP_DATABASE, serviceCapacities: rental.RENTAL_HTTP_SERVICE_CAPACITIES,
    funding: rental.RENTAL_HTTP_FUNDING, documents: rental.RENTAL_HTTP_DOCUMENTS,
    operationLogs: rental.RENTAL_HTTP_OPERATION_LOGS, corporateSettlement: rental.RENTAL_HTTP_CORPORATE_SETTLEMENT,
    memberships: rental.RENTAL_HTTP_MEMBERSHIPS, failureEvents: rental.RENTAL_HTTP_FAILURE_EVENTS,
    exchangePreview: rental.RENTAL_HTTP_EXCHANGE_PREVIEW, exchangeInspections: rental.RENTAL_HTTP_EXCHANGE_INSPECTIONS,
    exchangeInspectionMedia: rental.RENTAL_HTTP_EXCHANGE_INSPECTION_MEDIA,
    officialCalendarSources: rental.RENTAL_HTTP_OFFICIAL_CALENDAR_SOURCES,
    workspaceCapabilities: RENTAL_WORKSPACE_CAPABILITIES_APPLICATION, staffPayments: RENTAL_STAFF_PAYMENTS_APPLICATION,
  } satisfies Tokens<RentalHttpServiceGroups["rental"]>,
  enterprise: RENTAL_ENTERPRISE_HTTP,
  client: RENTAL_CLIENT_HTTP,
  category: { governance: RENTAL_HTTP_CATEGORY_GOVERNANCE, preparations: RENTAL_HTTP_CATEGORY_PREPARATIONS,
    adoptions: RENTAL_HTTP_CATEGORY_ADOPTIONS } satisfies Tokens<RentalHttpServiceGroups["category"]>,
  channels: { client: RENTAL_CLIENT_CHANNEL_APPLICATION, website: RENTAL_WEBSITE_CHANNEL_APPLICATION,
    assets: RENTAL_WEBSITE_ASSET_APPLICATION, miniProgram: RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION
  } satisfies Tokens<RentalHttpServiceGroups["channels"]>,
  members: { membership: RENTAL_MEMBERSHIP_APPLICATION, enterprisePortal: RENTAL_ENTERPRISE_PORTAL_APPLICATION
  } satisfies Tokens<RentalHttpServiceGroups["members"]>,
  files: { ledger: RENTAL_FILES_LEDGER, storage: RENTAL_FILES_STORAGE, database: RENTAL_FILES_DATABASE,
    customerAuthority: RENTAL_FILES_CUSTOMER_AUTHORITY } satisfies Tokens<RentalHttpServiceGroups["files"]>,
  staff: { auth: RENTAL_STAFF_AUTH_APPLICATION, database: RENTAL_STAFF_UPLOADS_DATABASE,
    storage: RENTAL_STAFF_UPLOADS_STORAGE, observe: RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER,
    inspectionEvidence: RENTAL_STAFF_INSPECTION_EVIDENCE } satisfies Tokens<RentalHttpServiceGroups["staff"]>,
  customer: { avatar: RENTAL_CUSTOMER_AVATAR_APPLICATION },
};

export const RENTAL_HTTP_DEPENDENCY_TOKENS: readonly symbol[] = Object.freeze([
  ...Object.values(RENTAL_HTTP_SERVICE_TOKENS).flatMap(group => Object.values(group)),
]);

/** resolve 只读取宿主 DI 中已注册的令牌，不能由请求或清单路径提供。
 * DI 容器的值在这一个边界恢复契约类型，原 provider 已核真实实现；没有业务执行兜底。 */
export function composeRentalHttpServiceGroups(resolve: (token: symbol) => unknown): RentalHttpServiceGroups {
  function group<T>(mapping: Tokens<T>): T {
    return Object.fromEntries(Object.entries(mapping).map(([key, token]) => [key, resolve(token as symbol)])) as T;
  }
  return {
    rental: group<RentalHttpServiceGroups["rental"]>(RENTAL_HTTP_SERVICE_TOKENS.rental),
    enterprise: group<RentalHttpServiceGroups["enterprise"]>(RENTAL_HTTP_SERVICE_TOKENS.enterprise),
    client: group<RentalHttpServiceGroups["client"]>(RENTAL_HTTP_SERVICE_TOKENS.client),
    category: group<RentalHttpServiceGroups["category"]>(RENTAL_HTTP_SERVICE_TOKENS.category),
    channels: group<RentalHttpServiceGroups["channels"]>(RENTAL_HTTP_SERVICE_TOKENS.channels),
    members: group<RentalHttpServiceGroups["members"]>(RENTAL_HTTP_SERVICE_TOKENS.members),
    files: group<RentalHttpServiceGroups["files"]>(RENTAL_HTTP_SERVICE_TOKENS.files),
    staff: group<RentalHttpServiceGroups["staff"]>(RENTAL_HTTP_SERVICE_TOKENS.staff),
    customerAvatar: resolve(RENTAL_CUSTOMER_AVATAR_APPLICATION) as RentalHttpServiceGroups["customerAvatar"],
  };
}
