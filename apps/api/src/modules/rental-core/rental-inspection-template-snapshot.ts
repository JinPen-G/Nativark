import { ConflictException } from "@nestjs/common";
import { RENTAL_CAPABILITY_CODES, type RentalCapability, type RentalCapabilityRequirementSnapshot, type RentalCategoryDefinition, type RentalInspectionTemplate } from "@rental-os/shared";
import { z } from "zod";
import { readRentalCategoryCode } from "./category-identity";
import { resolveCapabilityRequirements } from "./category-capability-conditions";

/** Decode existing frozen evidence without applying today's template defaults.
 * Empty is an explicit snapshot; absent, malformed or foreign evidence fails. */
export function readFrozenInspectionTemplates(value: unknown, tenantId: string, categoryCode: string): RentalInspectionTemplate[] {
  const text = z.string().min(1).max(191);
  const field = z.object({ code: text, label: z.string().min(1).max(1000), type: z.enum(["boolean", "number", "text", "select", "photo"]),
    required: z.boolean(), unit: z.string().max(191).optional(), options: z.array(z.string().max(1000)).max(1000).optional(),
    usageMetric: z.boolean().optional(), appliesToCapability: z.enum(RENTAL_CAPABILITY_CODES).optional() }).strict();
  const template = z.object({ id: text, tenantId: z.literal(tenantId),
    categoryCode: z.preprocess(readRentalCategoryCode, z.literal(categoryCode)), code: text, name: z.string().min(1).max(1000),
    stage: z.enum(["pickup", "return"]), version: text, fields: z.array(field).max(2000), enabled: z.boolean(),
    allocationIds: z.array(text).max(10000).optional(), sourceTemplateId: text.optional(), exchangeId: text.optional() }).strict();
  const parsed = z.array(template).max(200).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(row => row.id)).size !== parsed.data.length
    || parsed.data.some(row => new Set(row.fields.map(item => item.code)).size !== row.fields.length))
    throw new ConflictException("历史检查模板快照无效、缺失或超出读取上限");
  return parsed.data;
}

/** Materialize the executable template once; never expose mutable config objects as evidence. */
export function snapshotInspectionTemplate(definition: RentalCategoryDefinition, template: RentalInspectionTemplate,
  requirements?: RentalCapabilityRequirementSnapshot, activeRootItemGroupIds?: readonly string[]): RentalInspectionTemplate {
  const inactive = requirements ? resolveCapabilityRequirements(definition, requirements, activeRootItemGroupIds).inactive : undefined;
  return projectInspectionTemplatePolicy(definition, template, inactive);
}

/** Same policy projection for a frozen business snapshot or current adoption
 * candidate. Inactive codes must come from Core's trusted condition evaluation. */
export function projectInspectionTemplatePolicy(definition: RentalCategoryDefinition, template: RentalInspectionTemplate,
  inactiveConditionalCapabilities?: readonly RentalCapability[]): RentalInspectionTemplate {
  const snapshot = structuredClone(template);
  if (snapshot.code === `${definition.code.toUpperCase()}_${snapshot.stage.toUpperCase()}_V1`) {
    const optional = definition.businessModel.defaults.inspectionFields.filter((field) => !field.required);
    snapshot.fields = [
      ...snapshot.fields.map((field) => optional.some((row) => row.code === field.code) ? { ...field, required: false } : field),
      ...structuredClone(optional.filter((field) => !snapshot.fields.some((row) => row.code === field.code)))
    ];
  }
  if (inactiveConditionalCapabilities !== undefined) {
    const inactive = new Set(inactiveConditionalCapabilities);
    snapshot.fields = snapshot.fields.flatMap(field => {
      const policyField = definition.businessModel.defaults.inspectionFields.find(candidate => candidate.code === field.code);
      const capability = policyField?.appliesToCapability ?? field.appliesToCapability;
      if (!capability) return [field];
      if (!definition.defaultCapabilities.includes(capability)) throw new ConflictException("检查字段关联了未声明的能力");
      if (inactive.has(capability)) return [];
      if (policyField && field.type !== policyField.type) throw new ConflictException("检查模板字段与当前采用的品类合同不一致");
      return [{ ...field, required: policyField?.required ?? field.required, appliesToCapability: capability }];
    });
  }
  return snapshot;
}
