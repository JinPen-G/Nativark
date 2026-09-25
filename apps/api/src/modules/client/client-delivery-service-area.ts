import type { RentalDeliveryServiceAreaPolicy } from "@rental-os/shared";

export interface DeliveryAddressRegion {
  province?: string | null;
  city?: string | null;
  district?: string | null;
}

export interface DeliveryServiceAreaDecision {
  mode: "all" | "allowlist";
  allowed: boolean;
  matchedArea?: { province: string; city: string; district?: string };
}

const normalized = (value: unknown) => typeof value === "string" ? value.trim().toLocaleLowerCase() : "";

/**
 * 本地配送服务区按客户地址中的行政区划精确匹配。
 * 不做模糊包含、坐标猜测或外部地理编码；区县留空表示该市全域。
 */
export function evaluateDeliveryServiceArea(
  policy: RentalDeliveryServiceAreaPolicy | undefined,
  address: DeliveryAddressRegion
): DeliveryServiceAreaDecision {
  if (!policy || policy.mode !== "allowlist") return { mode: "all", allowed: true };

  const province = normalized(address.province);
  const city = normalized(address.city);
  const district = normalized(address.district);
  const matchedArea = (policy.areas ?? []).find((area) =>
    normalized(area.province) === province &&
    normalized(area.city) === city &&
    (!normalized(area.district) || normalized(area.district) === district)
  );
  return {
    mode: "allowlist",
    allowed: Boolean(matchedArea),
    matchedArea: matchedArea
      ? {
          province: matchedArea.province.trim(),
          city: matchedArea.city.trim(),
          ...(matchedArea.district?.trim() ? { district: matchedArea.district.trim() } : {})
        }
      : undefined
  };
}
