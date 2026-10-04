export type ProposalDisplayState = "available" | "expired" | "stale" | "unavailable";

export function proposalDisplayState(input: { expiresAt?: unknown; nowIso?: unknown; stale?: boolean }): ProposalDisplayState {
  if (input.stale === true) return "stale";
  if (typeof input.expiresAt !== "string" || typeof input.nowIso !== "string") return "unavailable";
  const expires = Date.parse(input.expiresAt), now = Date.parse(input.nowIso);
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return "unavailable";
  return expires <= now ? "expired" : "available";
}
