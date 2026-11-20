/** 浏览器消费候选请求和原回执投影，运行时路径保持无 Node 依赖。 */
export type {
  CorePackagePreparationRequest, CorePackagePrepareRequest, CorePackagePreparationQuery,
  CorePackagePreparationPlan, CorePackagePreparationRecord, CorePackagePreparationUnavailable,
  CorePackagePreparationPreview, CorePackagePreparationResult, CorePackagePreparationRead
} from "./ports";

export const CORE_PACKAGE_PREPARATION_HTTP = {
  preview: { method: "POST", path: "preview-preparation" },
  prepare: { method: "POST", path: "prepare" },
  receipt: { method: "POST", path: "preparation-receipt" }
} as const;
