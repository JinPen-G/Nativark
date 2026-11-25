/** 原服务时区入口。绑定同一 Core 登记与请求集合，沿宿主原配置 API 和当前会话。 */
import { createRentalMiniProgramServiceZones } from "@rental-os/rental-core/clients/miniprogram";
import { fetchConfig } from "../api/merchant";
import { currentServiceCode, isSignedIn } from "./session";

const zones = createRentalMiniProgramServiceZones({ fetchConfig, currentServiceCode, isSignedIn });
export const { rememberZone, zoneOf, knownZones, ensureCurrentZone } = zones;
