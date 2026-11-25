/** 原客户HTTP接线。明确绑定同一服务和Guard，保留会话、事务及Lifecycle的唯一实例。 */
import type { Provider, Type } from "@nestjs/common";
import { RENTAL_CLIENT_HTTP, type RentalClientHttpApplications } from "@rental-os/rental-core/http-client-applications";
import { ApiAuthGuard } from "../../common/api-auth.guard";
import { ClientApiService } from "./client-api.service";
import { ClientAuthService } from "./client-auth.service";
import { WebsiteAssetService } from "./website-asset.service";
import { ClientWechatAuthService } from "./client-wechat-auth.service";
import { ClientDeliveryAddressService } from "./client-delivery-address.service";
import { ClientAccountClosureService } from "./client-account-closure.service";
import { EnterpriseAccessService } from "./enterprise-access.service";

const participants = {
  api: ClientApiService,
  auth: ClientAuthService,
  websiteAssets: WebsiteAssetService,
  wechat: ClientWechatAuthService,
  addresses: ClientDeliveryAddressService,
  closure: ClientAccountClosureService,
  enterprise: EnterpriseAccessService,
  readGuard: ApiAuthGuard
} satisfies { [K in keyof RentalClientHttpApplications]: Type<RentalClientHttpApplications[K]> };

export const RENTAL_CLIENT_HTTP_PROVIDERS: Provider[] = Object.entries(participants).map(([key, source]) => ({
  provide: RENTAL_CLIENT_HTTP[key as keyof RentalClientHttpApplications],
  useExisting: source
}));
