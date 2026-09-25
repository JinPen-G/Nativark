import type { RentalDeliveryAddressSnapshot } from "@rental-os/shared";

/** Keep delivery contact data in persisted facts, but redact it from ordinary API responses. */
export function redactDeliveryAddressPhone<T>(value: T): T {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) {
      let changed = false;
      const next = current.map((item) => {
        const redacted = visit(item);
        changed ||= redacted !== item;
        return redacted;
      });
      return changed ? next : current;
    }
    if (!current || typeof current !== "object") return current;

    const source = current as Record<string, unknown>;
    let result: Record<string, unknown> | undefined;
    for (const [key, item] of Object.entries(source)) {
      if ((key === "deliveryAddressSnapshot" || key === "deliveryAddressDraft")
        && item && typeof item === "object" && !Array.isArray(item)) {
        const address = item as RentalDeliveryAddressSnapshot & { phone?: string };
        if (address.phone) {
          result ??= { ...source };
          result[key] = { ...address, phone: undefined };
        }
        continue;
      }
      const redacted = visit(item);
      if (redacted !== item) {
        result ??= { ...source };
        result[key] = redacted;
      }
    }
    return result ?? current;
  };

  return visit(value) as T;
}
