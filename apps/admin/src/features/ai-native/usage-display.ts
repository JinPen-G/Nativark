export type UsageDisplayInput = {
  status:
    | "reported"
    | "estimated"
    | "unknown"
    | "reserved"
    | "settled"
    | "pending_reconciliation";
  amount?: string;
  unit?: string;
  currency?: string;
};
export type UsageDisplay = {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "pending";
};
export function toUsageDisplay(input: UsageDisplayInput): UsageDisplay {
  if (input.status === "unknown" || input.status === "pending_reconciliation")
    return { label: "待核对", value: "未知用量", tone: "warning" };
  if (input.status === "reserved")
    return {
      label: "预留",
      value:
        input.amount && input.unit
          ? `${input.amount} ${input.unit}`
          : "已预留，金额待确认",
      tone: "pending",
    };
  if (!input.amount || !input.unit)
    return {
      label: input.status === "estimated" ? "估算" : "用量",
      value: "未定价",
      tone: "neutral",
    };
  return {
    label:
      input.status === "estimated"
        ? "估算用量"
        : input.status === "settled"
          ? "已结算用量"
          : "已报告用量",
    value: `${input.amount} ${input.unit}`,
    tone: "neutral",
  };
}
