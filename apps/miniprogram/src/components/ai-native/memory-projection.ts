/** Pure private projection. Preferences never confer business permissions. */
export function memoryProjection(input: unknown): { label: string; value: string; status: string } {
  const item = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const status = typeof item.status === "string" ? item.status : "unavailable";
  const humanConfirmed = status === "confirmed" && item.actorKind === "human" && item.revision === item.confirmedRevision;
  return {
    label: typeof item.label === "string" ? item.label.slice(0, 200) : "偏好不可用",
    value: (humanConfirmed || status === "proposed") && typeof item.value === "string" ? item.value.slice(0, 4000) : "内容不可用",
    status: humanConfirmed ? "已由人类确认（不代表权限）" : status === "confirmed" ? "确认失效，待人工核对" : status === "proposed" ? "待人工确认" : "已失效/不可用",
  };
}
