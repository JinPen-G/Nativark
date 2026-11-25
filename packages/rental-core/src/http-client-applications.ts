/** 客户HTTP只消费原实际实例。本人范围、用途证明、企业授权及读取后的Guard复验保持；
 * 明确令牌替代行业Controller对宿主源码的反向导入，不创建第二个Auth或数据库。 */
import type { ExecutionContext } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ClientApiService } from "./mysql-client-application";
import type { ClientAuthService } from "./mysql-client-auth";
import type { WebsiteAssetService } from "./mysql-client-website-assets";
import type { ClientDeliveryAddressService } from "./mysql-client-delivery-address";
import type { ClientAccountClosureService } from "./mysql-client-account-closure";
import type { EnterpriseAccessService } from "./mysql-enterprise-access";
import type { ClientRequestContext } from "./client-context";
import type {
  ClientMembershipSessionResponse, ClientWechatBindRequest, ClientWechatBindResponse, ClientWechatPhoneLoginRequest
} from "./client-contracts";

export interface RentalClientWechatHttp {
  phoneLogin(input: ClientWechatPhoneLoginRequest): Promise<ClientMembershipSessionResponse>;
  bind(context: ClientRequestContext, input: ClientWechatBindRequest): Promise<ClientWechatBindResponse>;
}

export interface RentalClientReadGuard {
  revalidateClientRead(context: ExecutionContext): Promise<boolean>;
}

export interface RentalClientHttpApplications {
  api: Pick<ClientApiService,
    "applyExtension" | "availability" | "bookingOptions" | "cancelOrder" |
    "catalog" | "channelBootstrap" | "claimCoupon" | "closePaymentIntent" |
    "completeQualificationUpload" | "config" | "contacts" | "corporateIdentities" |
    "coupons" | "createMiniProgramPaymentIntent" | "createOrder" | "createPaymentIntent" |
    "createQualificationUploadSession" | "createQuote" | "deleteContact" | "feeItems" |
    "fulfillment" | "funding" | "getOrder" | "getPaymentIntent" |
    "getQuote" | "listExtensions" | "listOrders" | "membershipAssignments" |
    "membershipBenefits" | "membershipPlans" | "membershipStatus" | "myOrders" |
    "notifications" | "orderDocument" | "orderDocumentVersions" | "payExtension" |
    "paymentCapabilities" | "previewCancellation" | "previewExtension" | "profile" |
    "publicCatalog" | "publicDocument" | "qualificationFileUrl" | "qualificationTypes" |
    "qualifications" | "readCatalogItemImage" | "readPublicCatalogItemImage" | "refreshPaymentIntent" |
    "rentalHandoffMaterial" | "resolveWebsiteHost" | "respondToFee" | "saveContact" |
    "simulateFunding" | "submitQualification" | "updateProfile">;
  auth: Pick<ClientAuthService,
    "changePassword" | "createChallenge" | "createClosureChallenge" | "listPublicWorkspaces" |
    "login" | "logout" | "refresh" | "registerPersonal" |
    "smsLogin" | "switchWorkspace" | "verifyChallenge">;
  websiteAssets: Pick<WebsiteAssetService, "read">;
  wechat: RentalClientWechatHttp;
  addresses: Pick<ClientDeliveryAddressService, "list" | "save" | "remove">;
  closure: Pick<ClientAccountClosureService<Prisma.TransactionClient>, "preview" | "close">;
  enterprise: Pick<EnterpriseAccessService, "entry" | "members">;
  readGuard: RentalClientReadGuard;
}

export const RENTAL_CLIENT_HTTP = {
  api: Symbol("RENTAL_CLIENT_HTTP_API"),
  auth: Symbol("RENTAL_CLIENT_HTTP_AUTH"),
  websiteAssets: Symbol("RENTAL_CLIENT_HTTP_WEBSITE_ASSETS"),
  wechat: Symbol("RENTAL_CLIENT_HTTP_WECHAT"),
  addresses: Symbol("RENTAL_CLIENT_HTTP_ADDRESSES"),
  closure: Symbol("RENTAL_CLIENT_HTTP_CLOSURE"),
  enterprise: Symbol("RENTAL_CLIENT_HTTP_ENTERPRISE"),
  readGuard: Symbol("RENTAL_CLIENT_HTTP_READ_GUARD")
} as const satisfies Record<keyof RentalClientHttpApplications, symbol>;
