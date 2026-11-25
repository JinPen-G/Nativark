/**
 * Expiry facts are optional category-specific asset attributes. If a tenant records an
 * expiry date, allocation/extension must not let the rental cross that date. Missing
 * values remain non-blocking because not every vehicle or tool uses the same documents.
 */
export function assetValidityError(
  categoryCode: string,
  attributes: Record<string, unknown>,
  rentalEndAt: string,
  timeZone: string
): string | undefined {
  const checks: Array<[string, string]> = categoryCode === "vehicle"
    ? [["insuranceExpiry", "车辆保险"], ["inspectionExpiry", "车辆年检"]]
    : categoryCode === "construction"
      ? [["inspectionExpiry", "设备检验"]]
      : [];
  if (!checks.length) return undefined;

  const end = new Date(rentalEndAt);
  if (!Number.isFinite(end.getTime())) return "订单租期结束时间无效，无法校验证照有效期";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(end);
  const part = (type: string) => parts.find((row) => row.type === type)?.value ?? "";
  const rentalEndDate = `${part("year")}-${part("month")}-${part("day")}`;

  for (const [field, label] of checks) {
    const value = attributes[field];
    if (value === undefined || value === null || value === "") continue;
    const expiryDate = typeof value === "string" ? value.slice(0, 10) : "";
    const parsedExpiry = new Date(`${expiryDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(expiryDate) || !Number.isFinite(parsedExpiry.getTime()) || parsedExpiry.toISOString().slice(0, 10) !== expiryDate) {
      return `${label}有效期格式无效`;
    }
    // Expiry dates are inclusive: an item can be rented through its stated final date.
    if (expiryDate < rentalEndDate) return `${label}已于 ${expiryDate} 到期，不能覆盖至 ${rentalEndDate}`;
  }
  return undefined;
}
