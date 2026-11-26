/** 首次配置由宿主绑定事务调用；日常配置与收据沿当前 CRM 管理权限执行。 */
import { createHash } from "node:crypto";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { CrmConfigurationSchema, CrmError, CrmIdSchema, CrmSettingsSchema, UpdateCrmSettingsSchema,
  initialCrmPipeline, type CrmConfiguration, type CrmSettings, type CrmSettingsInput, type CrmSettingsReceipt, type CrmReceiptLookup } from "./contracts";
import type { CrmAccess, CrmExecution, CrmRepository } from "./ports";

export async function initializeCrmConfiguration(store: CrmRepository, principal: CorePrincipal,
  input: CrmSettingsInput, clock: () => Date = () => new Date()): Promise<void> {
  if (principal.audience !== "operator") throw new CrmError("denied", "CRM 只接受租户后台身份");
  if (await store.settings()) throw new CrmError("already_initialized", "已有 CRM 配置不能被重新初始化覆盖");
  const now = clock().toISOString();
  await store.initialize(CrmSettingsSchema.parse({ ...input, tenantId: principal.tenantId, revision: 1, pipelineVersion: 1,
    defaultSourceId: "manual", sources: [{ id: "manual", name: "手工录入", active: true }],
    createdBy: principal.subjectId, updatedBy: principal.subjectId, createdAt: now, updatedAt: now }), initialCrmPipeline());
}

export class CrmSettingsService {
  constructor(private readonly execution: CrmExecution, private readonly clock: () => Date = () => new Date()) {}

  read(principal: CorePrincipal): Promise<CrmConfiguration> {
    return this.run(principal, false, async (store, access) => {
      const settings = this.own(await store.settings(), access);
      const pipeline = await store.pipeline(settings.pipelineVersion);
      if (!pipeline || pipeline.version !== settings.pipelineVersion) throw new CrmError("not_initialized", "CRM 销售流程配置缺失");
      return CrmConfigurationSchema.parse({ settings, pipeline });
    });
  }

  update(principal: CorePrincipal, input: unknown): Promise<CrmSettingsReceipt> {
    const parsed = UpdateCrmSettingsSchema.parse(input);
    const fingerprint = createHash("sha256").update(JSON.stringify([principal.tenantId, principal.subjectId, "settings.update", parsed])).digest("hex");
    return this.run(principal, true, async (store, access) => {
      const settings = this.own(await store.settings(), access);
      const previous = await store.receipt(parsed.operationId);
      if (previous) {
        if (previous.actorId !== access.userId || previous.fingerprint !== fingerprint)
          throw new CrmError("operation_conflict", "原操作键已用于其他请求，请核对原操作");
        this.own(previous.settings, access);
        return { operationId: previous.operationId, settings: previous.settings };
      }
      if (settings.revision !== parsed.expectedRevision || settings.revision >= Number.MAX_SAFE_INTEGER)
        throw new CrmError("revision_conflict", "配置已变化，请重新读取后操作");
      const updated = CrmSettingsSchema.parse({ ...settings, timeZone: parsed.timeZone, defaultCurrency: parsed.defaultCurrency,
        revision: settings.revision + 1, updatedBy: access.userId, updatedAt: this.clock().toISOString() });
      await store.updateSettings(updated, parsed.expectedRevision);
      const receipt = { operationId: parsed.operationId, settings: updated };
      await store.saveReceipt({ ...receipt, actorId: access.userId, fingerprint });
      return receipt;
    });
  }

  receipt(principal: CorePrincipal, operationId: string): Promise<CrmReceiptLookup> {
    CrmIdSchema.parse(operationId);
    return this.run(principal, false, async (store, access) => {
      const receipt = await store.receipt(operationId);
      if (!receipt || receipt.actorId !== access.userId) return { status: "unavailable" };
      this.own(await store.settings(), access);
      this.own(receipt.settings, access);
      return { status: "recorded", receipt: { operationId, settings: receipt.settings } };
    }, "original_receipt");
  }

  private run<T>(principal: CorePrincipal, mutation: boolean, work: (store: CrmRepository, access: CrmAccess) => Promise<T>,
    purpose: "business" | "original_receipt" = "business"): Promise<T> {
    if (principal.audience !== "operator") return Promise.reject(new CrmError("denied", "CRM 只接受租户后台身份"));
    return this.execution.run({ principal, permission: "manage", purpose, mutation }, (store, access) => {
      if (access.tenantId !== principal.tenantId || access.userId !== principal.subjectId)
        throw new CrmError("denied", "CRM 事务主体不一致");
      return work(store, access);
    });
  }
  private own(value: CrmSettings | undefined, access: CrmAccess): CrmSettings {
    if (!value) throw new CrmError("not_initialized", "CRM 尚未完成首次设置");
    if (value.tenantId !== access.tenantId) throw new CrmError("denied", "CRM 配置不属于当前租户");
    return value;
  }
}
