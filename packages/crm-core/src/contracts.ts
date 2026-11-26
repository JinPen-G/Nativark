/** CRM 自有业务合同。公共身份/绑定来自 Core 合同；这里不定义账号、订单或支付事实。 */
import { z } from "zod";

export const CRM_CORE_ID = "crm";
export const CRM_CORE_VERSION = "0.1.0";
export const CRM_DATA_VERSION = "0.1.0";
export const CRM_DATA_READABLE = Object.freeze({ minInclusive: "0.1.0", maxExclusive: "0.2.0" });
export const CrmIdSchema = z.string().min(1).max(36).regex(/^[a-zA-Z0-9_-]+$(?![\s\S])/);
export const CrmRevisionSchema = z.number().int().safe().positive();
export const CrmTimeZoneSchema = z.string().min(1).max(80).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "须使用有效的 IANA 时区");
// CRM 首版录入币种；不表示支付渠道支持，默认币种不会改写历史金额或触发换汇。
export const CrmCurrencySchema = z.enum(["CNY", "HKD", "USD", "EUR", "JPY", "GBP", "SGD", "AUD", "CAD", "TWD"]);
export const CrmSettingsInputSchema = z.object({ timeZone: CrmTimeZoneSchema, defaultCurrency: CrmCurrencySchema }).strict();
export type CrmSettingsInput = z.infer<typeof CrmSettingsInputSchema>;
export const CrmStageSchema = z.object({ id: CrmIdSchema, name: z.string().min(1).max(80), probability: z.number().int().min(0).max(100) }).strict();
export const CrmPipelineSchema = z.object({ version: CrmRevisionSchema, name: z.string().min(1).max(80),
  stages: z.array(CrmStageSchema).min(1).max(30) }).strict().superRefine((value, ctx) => {
  if (new Set(value.stages.map(stage => stage.id)).size !== value.stages.length)
    ctx.addIssue({ code: "custom", message: "阶段标识不能重复" });
});
export type CrmPipeline = z.infer<typeof CrmPipelineSchema>;
export function initialCrmPipeline(): CrmPipeline {
  return { version: 1, name: "默认销售流程", stages: [
    { id: "qualification", name: "需求确认", probability: 10 },
    { id: "proposal", name: "方案沟通", probability: 30 },
    { id: "negotiation", name: "商务协商", probability: 60 },
    { id: "decision", name: "待决策", probability: 80 }
  ] };
}
export const CrmSourceSchema = z.object({ id: CrmIdSchema, name: z.string().min(1).max(80), active: z.boolean() }).strict();
export const CrmSettingsSchema = CrmSettingsInputSchema.extend({ tenantId: CrmIdSchema, revision: CrmRevisionSchema,
  defaultSourceId: CrmIdSchema, sources: z.array(CrmSourceSchema).min(1).max(100),
  pipelineVersion: CrmRevisionSchema, createdBy: CrmIdSchema, updatedBy: CrmIdSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict().superRefine((value, ctx) => {
    if (new Set(value.sources.map(source => source.id)).size !== value.sources.length
      || !value.sources.some(source => source.id === value.defaultSourceId && source.active))
      ctx.addIssue({ code: "custom", message: "CRM 必须保留唯一标识的来源和有效默认来源" });
  });
export type CrmSettings = z.infer<typeof CrmSettingsSchema>;
export const CrmConfigurationSchema = z.object({ settings: CrmSettingsSchema, pipeline: CrmPipelineSchema }).strict();
export type CrmConfiguration = z.infer<typeof CrmConfigurationSchema>;
export const UpdateCrmSettingsSchema = CrmSettingsInputSchema.extend({ operationId: CrmIdSchema, expectedRevision: CrmRevisionSchema }).strict();
export const CrmSettingsReceiptSchema = z.object({ operationId: CrmIdSchema, settings: CrmSettingsSchema }).strict();
export type CrmSettingsReceipt = z.infer<typeof CrmSettingsReceiptSchema>;
export const CrmReceiptLookupSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), receipt: CrmSettingsReceiptSchema }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);
export type CrmReceiptLookup = z.infer<typeof CrmReceiptLookupSchema>;
export class CrmError extends Error {
  constructor(readonly code: "denied" | "not_initialized" | "revision_conflict" | "operation_conflict" | "already_initialized", message: string) {
    super(message); this.name = "CrmError";
  }
}
