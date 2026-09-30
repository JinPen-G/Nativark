import type { RentalCategoryDefinition, RentalInspectionTemplate } from "@rental-os/shared";

/** Materialize the executable template once; never expose mutable config objects as evidence. */
export function snapshotInspectionTemplate(definition: RentalCategoryDefinition, template: RentalInspectionTemplate): RentalInspectionTemplate {
  const snapshot = structuredClone(template);
  if (snapshot.code !== `${definition.code.toUpperCase()}_${snapshot.stage.toUpperCase()}_V1`) return snapshot;
  const optional = definition.businessModel.defaults.inspectionFields.filter((field) => !field.required);
  snapshot.fields = [
    ...snapshot.fields.map((field) => optional.some((row) => row.code === field.code) ? { ...field, required: false } : field),
    ...structuredClone(optional.filter((field) => !snapshot.fields.some((row) => row.code === field.code)))
  ];
  return snapshot;
}
