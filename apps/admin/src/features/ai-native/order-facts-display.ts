import type { AiOrderReadFactsDraft } from "../../../../../packages/shared/src/ai-order-facts-draft";

export type DisplayOrderAmount = number | null;
export interface DisplayOrderFacts {
  orderId: string;
  orderNo: string;
  status: string;
  currency: string;
  observedAt: string;
  sourceScope: string;
  sourceBasis: "current";
  amounts: Readonly<Record<"rental" | "service" | "discount" | "coupon" | "deposit" | "preAuthorization" | "finalPayable", DisplayOrderAmount>>;
}

const keys = ["rental", "service", "discount", "coupon", "deposit", "preAuthorization", "finalPayable"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const safeText = (value: unknown, max: number): string | null => typeof value === "string" && value.trim() && value.length <= max ? value : null;
const safeAmount = (value: unknown): number | null => value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(value) || typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Whitelist adapter for the existing shared facts draft; it never derives or fills facts. */
export function toDisplayOrderFacts(input: unknown): DisplayOrderFacts | null {
  if (!isRecord(input) || input.draftVersion !== "ain-order-facts-draft-1" || input.paymentEvidence !== "not_loaded" || input.historicalFeeEvidence !== "not_loaded") return null;
  const order = input.order;
  const scope = input.scope;
  const source = Array.isArray(input.sources) && input.sources.length === 1 ? input.sources[0] : null;
  if (!isRecord(order) || !isRecord(scope) || !isRecord(source) || !isRecord(order.amounts) || !isRecord(source.basis) || source.basis.kind !== "current") return null;
  const orderId = safeText(order.id, 191), orderNo = safeText(order.orderNo, 191), status = safeText(order.status, 80), currency = safeText(order.currency, 3), observedAt = safeText(input.observedAt, 80), sourceScope = safeText(source.scope && isRecord(source.scope) ? source.scope.id : null, 191);
  if (!orderId || !orderNo || !status || !currency || !observedAt || !sourceScope) return null;
  const rawAmounts = order.amounts as Record<string, unknown>;
  const amounts = Object.fromEntries(keys.map(key => [key, safeAmount(rawAmounts[key])])) as DisplayOrderFacts["amounts"];
  return { orderId, orderNo, status, currency, observedAt, sourceScope, sourceBasis: "current", amounts };
}

export function orderFactsRows(facts: DisplayOrderFacts): readonly { label: string; value: string; known: boolean }[] {
  const labels: Record<keyof DisplayOrderFacts["amounts"], string> = { rental: "租金", service: "服务", discount: "折扣", coupon: "优惠券", deposit: "押金", preAuthorization: "预授权", finalPayable: "最终应付" };
  return keys.map(key => ({ label: labels[key], value: facts.amounts[key] === null ? "未加载" : String(facts.amounts[key]), known: facts.amounts[key] !== null }));
}
