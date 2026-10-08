export interface InspectionDraftRow {
  key: string;
  label: string;
  candidate: string | null;
  humanValue: string | null;
  sourceLabel: string | null;
  state: "candidate_only" | "human_value" | "needs_review" | "empty";
}
const text = (value: unknown, limit: number): string | null => typeof value === "string" && value.trim() ? value.slice(0, limit) : null;

/** Read-only projection for an existing inspection draft; it never assigns liability or charges. */
export function toInspectionDraftRows(input: unknown): readonly InspectionDraftRow[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).flatMap((value): InspectionDraftRow[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const key = text(row.key, 128), label = text(row.label, 200);
    if (!key || !label || ["__proto__", "constructor", "prototype"].includes(key)) return [];
    const candidate = text(row.candidate, 4000), humanValue = text(row.humanValue, 4000), sourceLabel = text(row.sourceLabel, 200);
    return [{ key, label, candidate, humanValue, sourceLabel, state: humanValue ? "human_value" : candidate ? "candidate_only" : "empty" }];
  });
}
