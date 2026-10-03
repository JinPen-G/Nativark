/** Pure private projection. Preferences never confer business permissions. */
export function memoryProjection(input: unknown, nowIso = ""): { label: string; value: string; status: string } {
  const item = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const status = typeof item.status === "string" ? item.status : "unavailable";
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
  const now = Date.parse(nowIso);
  const expiry = typeof item.expiresAt === "string" ? Date.parse(item.expiresAt) : NaN;
  const current = Number.isFinite(now) && Number.isFinite(expiry) && expiry > now;
  const evidence = nonempty(item.revision) && nonempty(item.confirmedRevision) && item.revision === item.confirmedRevision &&
    nonempty(item.contentHash) && nonempty(item.confirmedContentHash) && item.contentHash === item.confirmedContentHash;
  const humanConfirmed = status === "confirmed" && item.actorKind === "human" && evidence && current;
  return {
    label: typeof item.label === "string" ? item.label.slice(0, 200) : "偏好不可用",
    value: (humanConfirmed || (status === "proposed" && current)) && typeof item.value === "string" ? item.value.slice(0, 4000) : "内容不可用",
    status: humanConfirmed ? "已由人类确认（不代表权限）" : status === "confirmed" ? "确认失效，待人工核对" : status === "proposed" && current ? "待人工确认" : "已失效/不可用",
  };
}
