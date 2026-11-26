/** CRM 设置事务窄端口；不向领域服务开放全库、公共角色写入或外部副作用。 */
import type { CorePrincipal } from "@rental-os/core-contracts";
import type { CrmPipeline, CrmSettings, CrmSettingsReceipt } from "./contracts";

export interface CrmStoredReceipt extends CrmSettingsReceipt { actorId: string; fingerprint: string }
export interface CrmRepository {
  settings(): Promise<CrmSettings | undefined>;
  pipeline(version: number): Promise<CrmPipeline | undefined>;
  initialize(settings: CrmSettings, pipeline: CrmPipeline): Promise<void>;
  updateSettings(settings: CrmSettings, expectedRevision: number): Promise<void>;
  receipt(operationId: string): Promise<CrmStoredReceipt | undefined>;
  saveReceipt(receipt: CrmStoredReceipt): Promise<void>;
}
export interface CrmAccess { readonly tenantId: string; readonly userId: string }
export interface CrmExecutionRequest {
  principal: CorePrincipal;
  permission: "manage";
  purpose: "business" | "original_receipt";
  mutation: boolean;
}
export interface CrmExecution {
  /** 原主体/授权先锁，设置写入再锁。本事务包含业务、原收据、审计，释放结果前复验授权。 */
  run<T>(request: CrmExecutionRequest, work: (store: CrmRepository, access: CrmAccess) => Promise<T>): Promise<T>;
}
