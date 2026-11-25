/** Local section drafts and Core-supplied field suggestions. Saving still sends
 * one original section; this module does not validate or publish a category. */
import { CATEGORY_DRAFT_SECTIONS, type CategoryDraftSection, type CategoryVersionView,
  type RentalCapability, type RentalCapabilityCompositionContract, type RentalCategoryDefinition } from "@rental-os/shared";

const ownership: Record<CategoryDraftSection, string[]> = {
  basic: ["name", "description", "terminology", "display"], attributes: ["attributeSchema", "assetFields", "catalogPresentation"],
  inventory: ["supportedInventoryModes", "fulfillmentModes", "locationTypes", "deliveryDestination"],
  pricing: ["pricingUnits", "defaultPricingUnit", "settingModules", "supportsHolidayPricing", "supportsUsagePricing", "supportsPreauthorization", "payment", "overdue", "fulfillment"],
  inspection: ["supportsQualificationReview", "rules", "inspectionFields"], capabilities: ["defaultCapabilities", "requiredCapabilities", "conditionalCapabilities", "valueAddedServicePresets"]
};
const rootFields = new Set(["name", "description", "terminology", "display", "attributeSchema", "supportedInventoryModes", "defaultCapabilities", "requiredCapabilities", "conditionalCapabilities"]);
const defaultFields = new Set(["payment", "overdue", "fulfillment", "rules", "inspectionFields"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function projectCategoryDraftSection(version: CategoryVersionView, section: CategoryDraftSection): Record<string, unknown> {
  const root = version.definition as unknown as Record<string, unknown>;
  const business = root.businessModel as Record<string, unknown>;
  const defaults = business.defaults as Record<string, unknown>;
  const projected = Object.fromEntries(ownership[section].flatMap(key => {
    const value = root[key] ?? business[key] ?? defaults[key];
    return value === undefined ? [] : [[key, structuredClone(value)]];
  }));
  if (section === "basic") {
    const englishTerms = Object.fromEntries(Object.entries(version.definition.terminology).map(([key, value]) => [key,
      record(value) ? Object.fromEntries(Object.keys(value).map(field => [field, ""])) : ""]));
    const display = record(projected.display) ? projected.display : {};
    projected.display = { nameEn: "", descriptionEn: "", icon: "rental", defaultWorkspaceName: "", defaultWorkspaceNameEn: "", ...display,
      terminologyEn: { ...englishTerms, ...(record(display.terminologyEn) ? display.terminologyEn : {}) } };
  }
  if (section === "capabilities" && !projected.conditionalCapabilities) projected.conditionalCapabilities = [];
  return projected;
}

export interface CategorySectionDraft {
  values: Record<string, unknown>;
  baseValues: Record<string, unknown>;
  baseRevision: number;
  reason: string;
  dirty: boolean;
  pendingField: boolean;
  conflict: boolean;
  generation: number;
}
export type CategorySectionDrafts = Record<CategoryDraftSection, CategorySectionDraft>;

export function sameCategoryDraftValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameCategoryDraftValue(value, right[index]));
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameCategoryDraftValue(left[key], right[key]));
}
function freshSection(version: CategoryVersionView, section: CategoryDraftSection, generation = 0): CategorySectionDraft {
  const values = projectCategoryDraftSection(version, section);
  return { values, baseValues: structuredClone(values), baseRevision: version.revision, reason: "", dirty: false, pendingField: false, conflict: false, generation };
}
export function initialCategorySectionDrafts(version: CategoryVersionView): CategorySectionDrafts {
  return Object.fromEntries(CATEGORY_DRAFT_SECTIONS.map(section => [section, freshSection(version, section)])) as CategorySectionDrafts;
}
export const categorySectionHasInput = (draft: CategorySectionDraft) => draft.dirty || draft.pendingField || Boolean(draft.reason.trim());
export function resetCategoryDraftSection(drafts: CategorySectionDrafts, version: CategoryVersionView, section: CategoryDraftSection): CategorySectionDrafts {
  return { ...drafts, [section]: freshSection(version, section, drafts[section].generation + 1) };
}

/** A successful save may advance other sections' revisions only when their
 * original fields stayed unchanged. New server values never erase local input. */
export function reconcileCategorySectionDrafts(drafts: CategorySectionDrafts, next: CategoryVersionView,
  saved?: { section: CategoryDraftSection; values: Record<string, unknown>; reason: string }): CategorySectionDrafts {
  return Object.fromEntries(CATEGORY_DRAFT_SECTIONS.map(section => {
    const draft = drafts[section];
    if (saved?.section === section && sameCategoryDraftValue(draft.values, saved.values) && draft.reason === saved.reason && !draft.pendingField)
      return [section, freshSection(next, section, draft.generation + 1)];
    const current = projectCategoryDraftSection(next, section);
    if (!categorySectionHasInput(draft)) return [section, freshSection(next, section, draft.generation + (sameCategoryDraftValue(draft.values, current) ? 0 : 1))];
    if (!sameCategoryDraftValue(draft.baseValues, current)) return [section, { ...draft, conflict: true }];
    return [section, { ...draft, baseRevision: next.revision, conflict: false }];
  })) as CategorySectionDrafts;
}

/** Used only to explain cross-section choices. The API receives the selected
 * section's values and remains the authority for composition compatibility. */
export function categoryDefinitionWithLocalSections(version: CategoryVersionView, drafts: CategorySectionDrafts): RentalCategoryDefinition {
  const definition = structuredClone(version.definition);
  const root = definition as unknown as Record<string, unknown>, business = root.businessModel as Record<string, unknown>;
  const defaults = business.defaults as Record<string, unknown>;
  for (const section of CATEGORY_DRAFT_SECTIONS) for (const key of ownership[section]) {
    if (!Object.hasOwn(drafts[section].values, key)) continue;
    const target = rootFields.has(key) ? root : defaultFields.has(key) ? defaults : business;
    target[key] = structuredClone(drafts[section].values[key]);
  }
  return definition;
}

export function categoryInspectionFieldSuggestion(drafts: CategorySectionDrafts, capability: {
  code: RentalCapability; composition?: RentalCapabilityCompositionContract;
}) {
  const source = drafts.inspection.values.inspectionFields;
  const current = Array.isArray(source) && source.every(record) ? source as Array<Record<string, unknown>> : undefined;
  const required = capability.composition?.requiredInspectionFields;
  // The existing category field format applies to pickup and return together.
  // A more specific executable contract must be reviewed in its own editor.
  const supported = current !== undefined && capability.composition?.version === 1 && Boolean(required?.length) && required!.every(field =>
    Array.isArray(field.stages) && field.stages.length === 2 && field.stages.includes("pickup") && field.stages.includes("return"));
  const additions: Array<Record<string, unknown>> = [], conflicts: string[] = [];
  if (supported) for (const field of required!) {
    const matching = current!.filter(row => row.code === field.code);
    if (!matching.length) additions.push({ code: field.code, label: field.label, type: field.type, required: true, appliesToCapability: capability.code });
    else if (matching.length !== 1 || matching[0].type !== field.type || matching[0].required !== true || matching[0].appliesToCapability !== capability.code) conflicts.push(field.code);
  }
  return { supported, additions, conflicts, source: structuredClone(source), next: supported ? [...structuredClone(current!), ...additions] : undefined };
}
