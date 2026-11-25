/** 原官网配置与图片上传委托 Rental 单源工厂，传输沿原宿主提供。 */
import { createRentalWebsiteChannelApi } from "@rental-os/rental-core/admin/channels/website-client";
import { request } from "./http";

export const websiteChannelApi = createRentalWebsiteChannelApi(request);
