/** 原 SaaS 模型配置的受控页面与客户端。宿主显式供给同一 AiAdminHost；不隐式启用模型。 */
export { PlatformModelSettingsPage, PlatformModelDirectory } from "./PlatformModelSettingsPage";
export { PlatformPriceReview } from "./PlatformPriceReview";
export { PlatformBudgetSettings } from "./PlatformBudgetSettings";
export { PlatformCapabilityObservation } from "./PlatformCapabilityObservation";
export { PlatformAiCreditSettings, TenantAiCreditSettings } from "./AiCreditSettings";
export { createPlatformAiSettingsApi } from "./platformAiSettings";
export { createAiBudgetSettingsApi } from "./aiBudgetSettings";
export { createAiCreditApi, type AiCreditApi } from "./aiCredit";
