import type { TenantReadinessStatus } from "@rental-os/shared";

export type ReadinessItemState = "required" | "optional" | "unavailable" | "completed";

export interface ReadinessDiagnosticRow {
  key: string;
  title: string;
  state: ReadinessItemState;
  missing: string;
  nextHref: string;
  summary?: string;
}

export interface ReadinessDiagnosticsDisplay {
  tenantId: string;
  workspaceId: string;
  status: TenantReadinessStatus["status"];
  ready: boolean;
  rows: ReadinessDiagnosticRow[];
  quoteBlockers: string[];
  unavailable: boolean;
}

/**
 * Adapt the existing server-owned readiness projection for a read-only AI
 * surface. It does not infer readiness from item counts and does not turn an
 * unavailable source into an incomplete or completed item.
 */
export function toReadinessDiagnostics(input: unknown): ReadinessDiagnosticsDisplay | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<TenantReadinessStatus>;
  if (
    typeof value.tenantId !== "string" ||
    typeof value.workspaceId !== "string" ||
    (value.status !== "not_started" && value.status !== "configuring" && value.status !== "completed") ||
    typeof value.ready !== "boolean" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.quoteBlockers)
  ) return null;

  const rows: ReadinessDiagnosticRow[] = [];
  for (const item of value.items) {
    if (!item || typeof item !== "object") return null;
    const row = item as TenantReadinessStatus["items"][number];
    if (typeof row.key !== "string" || typeof row.title !== "string" || typeof row.done !== "boolean" || typeof row.missing !== "string" || typeof row.nextHref !== "string") return null;
    const state: ReadinessItemState = row.unavailable ? "unavailable" : row.done ? "completed" : row.optional ? "optional" : "required";
    rows.push({ key: row.key, title: row.title, state, missing: row.missing, nextHref: row.nextHref, ...(row.summary ? { summary: row.summary } : {}) });
  }
  return {
    tenantId: value.tenantId,
    workspaceId: value.workspaceId,
    status: value.status,
    ready: value.ready,
    rows,
    quoteBlockers: value.quoteBlockers.filter((blocker): blocker is string => typeof blocker === "string"),
    unavailable: rows.some((row) => row.state === "unavailable")
  };
}

