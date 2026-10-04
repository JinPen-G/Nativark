import type { CategoryDefinitionDifference } from "@rental-os/shared";
import type { CategoryGovernanceSummary } from "@/api/categoryGovernance";

export interface CategoryDifferenceDisplayRow {
  path: string;
  section: string;
  label: string;
  kind: CategoryDefinitionDifference["kind"];
  before: string;
  after: string;
}

export interface CategoryGovernanceDisplay {
  code: string;
  name: string;
  openingScope: string;
  openingRevision: number;
  recommendedVersion: string;
  latestPublished: string;
  draftCount: number;
  adoptedSpaces: number;
  adoptedTenants: number;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "未提供";
  if (typeof value === "string") return value.slice(0, 500);
  try { return JSON.stringify(value).slice(0, 500); } catch { return "无法展示"; }
}

export function toCategoryDifferenceRows(input: unknown): CategoryDifferenceDisplayRow[] | null {
  if (!Array.isArray(input)) return null;
  const rows: CategoryDifferenceDisplayRow[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") return null;
    const value = entry as Partial<CategoryDefinitionDifference>;
    if (typeof value.path !== "string" || typeof value.section !== "string" || typeof value.label !== "string" || typeof value.kind !== "string") return null;
    rows.push({ path: value.path, section: value.section, label: value.label, kind: value.kind as CategoryDefinitionDifference["kind"], before: displayValue(value.before), after: displayValue(value.after) });
  }
  return rows;
}

export function toCategoryGovernanceDisplay(input: unknown): CategoryGovernanceDisplay | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<CategoryGovernanceSummary>;
  if (typeof value.code !== "string" || typeof value.name !== "string" || typeof value.openingScope !== "string" || typeof value.openingRevision !== "number" || !Number.isSafeInteger(value.openingRevision) || typeof value.adoptedSpaces !== "number" || typeof value.adoptedTenants !== "number" || !Array.isArray(value.drafts)) return null;
  return {
    code: value.code,
    name: value.name,
    openingScope: value.openingScope,
    openingRevision: value.openingRevision,
    recommendedVersion: value.recommendedVersionLabel ?? "未设置",
    latestPublished: value.latestPublished?.versionLabel ?? "无已发布版本",
    draftCount: value.drafts.length,
    adoptedSpaces: value.adoptedSpaces,
    adoptedTenants: value.adoptedTenants
  };
}

