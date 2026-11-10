/** General kit admission reuses the existing handover decisions. The new version requires explicit evidence; camera legacy behavior stays registered unchanged. */
import { RentalInventoryMode, type RentalCapabilityHookModule, type RentalCapabilityHookResult } from "@rental-os/shared";
import { evaluateKitHandover } from "./camera-kit-handover";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function evaluate(point: "pickup_delivery" | "return_inspection", value: unknown): RentalCapabilityHookResult {
  const block = (code: string, message: string): RentalCapabilityHookResult => ({ decision: "block", blockReasons: [{ code, message }] });
  if (!record(value) || !record(value.order) || !Array.isArray(value.order.lines) || value.order.lines.some(line => !record(line))) {
    return block("kit_scope_unavailable", "套装检查缺少可核对的订单商品范围");
  }
  const lines = (value.order.lines as Record<string, unknown>[]).filter(line => line.inventoryMode === RentalInventoryMode.Bundle);
  if (!lines.length) return { decision: "allow" };
  if (lines.some(line => typeof line.itemGroupName !== "string" || !line.itemGroupName.trim())) {
    return block("kit_scope_unavailable", "套装商品资料缺失，请先核对本次交接对象");
  }
  if (value.inspectionSkipped || !record(value.results) || !Object.prototype.hasOwnProperty.call(value.results, "kit_complete")) {
    return block("kit_inspection_required", "套装必须明确记录附件是否齐全，才能完成本次交接");
  }
  const outcome = evaluateKitHandover(point, value as Parameters<typeof evaluateKitHandover>[1]);
  const normalize = (notices: RentalCapabilityHookResult["notices"]) => notices?.map(notice => ({ ...notice, code: notice.code.replace(/^camera_kit_/u, "kit_") }));
  return { ...outcome, ...(outcome.blockReasons ? { blockReasons: normalize(outcome.blockReasons) } : {}),
    ...(outcome.notices ? { notices: normalize(outcome.notices) } : {}) };
}

export function buildKitHandoverHookModule(): RentalCapabilityHookModule {
  return {
    code: "kit_handover", implementationVersion: "kit-1.0", order: 30,
    composition: { version: 1, subjectScope: "order", applicableInventoryModes: [RentalInventoryMode.Bundle],
      requiredInspectionFields: [{ code: "kit_complete", label: "套装附件齐全", type: "boolean", stages: ["pickup", "return"] }] },
    hooks: { pickup_delivery: context => evaluate("pickup_delivery", context.subject),
      return_inspection: context => evaluate("return_inspection", context.subject) }
  };
}
