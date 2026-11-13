import type { AiOpeningBusinessMaterialDraft, AiOpeningSectionMaterialDraft, TenantReadinessStatus } from "@rental-os/shared";

export type ReadinessItemState = "required" | "optional" | "unavailable" | "completed" | "unclassified";

export interface ReadinessDiagnosticRow {
  key: string;
  title: string;
  state: ReadinessItemState;
  missing: string;
  nextHref: string;
  summary?: string;
  evidence?: AiOpeningSectionMaterialDraft["evidence"];
  manual?: AiOpeningSectionMaterialDraft["manual"];
  fieldsToReview?: string[];
}

export interface ReadinessDiagnosticsDisplay {
  tenantId: string;
  workspaceId: string;
  status: TenantReadinessStatus["status"] | null;
  ready: boolean | null;
  rows: ReadinessDiagnosticRow[];
  quoteBlockers: string[] | null;
  unavailable: boolean;
  observedAt?: string;
  configVersion?: string;
  externalVerification?: "not_loaded";
}

/**
 * Adapt the existing server-owned readiness projection for a read-only AI
 * surface. It does not infer readiness from item counts and does not turn an
 * unavailable source into an incomplete or completed item.
 */
export function toReadinessDiagnostics(input: unknown): ReadinessDiagnosticsDisplay | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Partial<TenantReadinessStatus>;
  if (
    typeof value.tenantId !== "string" ||
    !value.tenantId || value.tenantId.length > 191 ||
    typeof value.workspaceId !== "string" ||
    !value.workspaceId || value.workspaceId.length > 191 ||
    (value.status !== "not_started" && value.status !== "configuring" && value.status !== "completed") ||
    typeof value.ready !== "boolean" ||
    !Array.isArray(value.items) || value.items.length > 50 ||
    !Array.isArray(value.quoteBlockers) || value.quoteBlockers.length > 50 ||
    value.quoteBlockers.some(blocker => typeof blocker !== "string" || blocker.length > 1000)
  ) return null;

  const rows: ReadinessDiagnosticRow[] = [];
  for (const item of value.items) {
    if (!item || typeof item !== "object") return null;
    const row = item as TenantReadinessStatus["items"][number];
    if (typeof row.key !== "string" || !row.key || row.key.length > 191 || rows.some(previous => previous.key === row.key)
      || typeof row.title !== "string" || !row.title || row.title.length > 200 || typeof row.done !== "boolean"
      || typeof row.missing !== "string" || row.missing.length > 1000 || typeof row.nextHref !== "string" || row.nextHref.length > 1000
      || row.optional !== undefined && typeof row.optional !== "boolean" || row.unavailable !== undefined && typeof row.unavailable !== "boolean"
      || row.summary !== undefined && (typeof row.summary !== "string" || row.summary.length > 1000)) return null;
    const state: ReadinessItemState = row.unavailable ? "unavailable" : row.done ? "completed" : row.optional ? "optional" : "required";
    rows.push({ key: row.key, title: row.title, state, missing: row.missing, nextHref: row.nextHref, ...(row.summary ? { summary: row.summary } : {}) });
  }
  return {
    tenantId: value.tenantId,
    workspaceId: value.workspaceId,
    status: value.status,
    ready: value.ready,
    rows,
    quoteBlockers: value.quoteBlockers.slice(),
    unavailable: rows.some((row) => row.state === "unavailable")
  };
}

/** Project an already validated original opening material. Selected sections
 * cannot establish the Core aggregate or quote blockers that were not sent. */
export function toOpeningReadinessDiagnostics(material: AiOpeningBusinessMaterialDraft): ReadinessDiagnosticsDisplay {
  const rows: ReadinessDiagnosticRow[] = material.sections.map(section => ({
    key: section.key, title: section.title,
    state: section.status === "source_unavailable" ? "unavailable"
      : section.status === "readiness_check_passed" ? "completed"
        : section.status === "unclassified" ? "unclassified" : section.required ? "required" : "optional",
    missing: section.issue ?? "", summary: section.summary, nextHref: "", evidence: section.evidence, manual: section.manual,
    fieldsToReview: [...section.candidate.fieldsToReview]
  }));
  return { tenantId: material.scope.tenantId, workspaceId: material.scope.workspaceId,
    status: null, ready: null, rows, quoteBlockers: null, unavailable: rows.some(row => row.state === "unavailable"),
    observedAt: material.observedAt, configVersion: material.configVersion, externalVerification: material.externalVerification };
}
