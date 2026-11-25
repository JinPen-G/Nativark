/** 原策略兼容入口：只注入 Shared 唯一常量，规则由 Rental 单源维护。 */
import * as contracts from "@rental-os/shared";
import { createRentalPlatformAiPolicy } from "@rental-os/rental-core/platform-ai-access-policy";
export const { PLATFORM_AI_PROVIDER_PERMISSIONS, isPlatformAiProviderPath, platformAiProviderPermission, platformCapabilityProbePermission, platformRetentionPermission } = createRentalPlatformAiPolicy(contracts);
