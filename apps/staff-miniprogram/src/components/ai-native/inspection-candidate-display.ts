/** Display-only inspection text and model hints. No links, commands, adoption
 * decisions or business validation are derived from recognition wording. */
export function inspectionSourceText(value: unknown): string {
  if (typeof value !== "string" || value.length > 4000) return "";
  const characters = Array.from(value);
  if (characters.length > 2000) return "";
  const text = characters.join("")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [已脱敏]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/gu, "[已脱敏]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret|密钥|令牌|密码)\s*[=:：]\s*)["']?[^\s,;，；"']+["']?/giu, "$1[已脱敏]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[邮箱已脱敏]")
    .replace(/\b[1-9][0-9]{16}[0-9X]\b/giu, "[证件号已脱敏]")
    .replace(/\b(?:\+?86[ -]?)?(1[3-9][0-9])[0-9]{4}([0-9]{4})\b/gu, "$1****$2")
    .trim();
  return Array.from(text).slice(0, 2000).join("");
}

/** Preserve the original 0..1 score, including zero. It is a model hint only. */
export function inspectionConfidenceLabel(status: unknown, value: unknown): string {
  return status === "candidate" && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? String(value) : "";
}

export function inspectionCandidateStatusLabel(status: unknown): string {
  return status === "candidate" ? "识别候选" : status === "missing" ? "缺失" : status === "blurred" ? "模糊" : "未记录";
}
