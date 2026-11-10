import { ConflictException } from "@nestjs/common";
import type { RentalCapability, RentalCapabilityRequirementSnapshot, RentalCategoryDefinition, RentalInspectionTemplate } from "@rental-os/shared";
import { resolveCapabilityRequirements } from "./category-capability-conditions";

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
