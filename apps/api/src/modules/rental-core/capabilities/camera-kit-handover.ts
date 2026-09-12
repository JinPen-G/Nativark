import {
  RentalInventoryMode,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookResult
} from "@store-rental/shared";

/** CAM-01B：摄影套装交接与附件清点规则版本。 */
export const CAMERA_KIT_HANDOVER_RULESET_VERSION = "cam-kit-1.0";

/**
 * 旧空间/旧订单可能仍固化为 `unimplemented`。该版本只作为兼容桥保留，
 * 不能从注册表删除，否则旧快照在归还时会因找不到实现而 fail-closed。
 */
export const CAMERA_KIT_HANDOVER_LEGACY_VERSION = "unimplemented";

type KitLine = { inventoryMode?: RentalInventoryMode | string; itemGroupName?: string; quantity?: number };

interface CameraKitHandoverSubject {
  order?: { lines?: KitLine[] };
  results?: Record<string, unknown>;
  exceptions?: Array<{ code?: string; description?: string }>;
}

const MISSING_KIT_EXCEPTION_CODES = new Set([
  "missing_item",
  "missing_accessory",
  "accessory_missing",
  "kit_incomplete"
]);

function hasBundle(subject: CameraKitHandoverSubject) {
  return (subject.order?.lines ?? []).some((line) => line.inventoryMode === RentalInventoryMode.Bundle);
}

function kitLines(subject: CameraKitHandoverSubject) {
  return (subject.order?.lines ?? [])
    .filter((line) => line.inventoryMode === RentalInventoryMode.Bundle)
    .map((line) => line.itemGroupName || "摄影套装")
    .join("、");
}

function evaluateKitHandover(
  point: "pickup_delivery" | "return_inspection",
  subject: CameraKitHandoverSubject
): RentalCapabilityHookResult {
  // 兼容旧模板与没有套装的摄影订单：没有明确的套装清点结果时，不凭空把单子拦住。
  if (!hasBundle(subject)) return { decision: "allow" };
  const result = subject.results?.kit_complete;
  if (result === undefined) return { decision: "allow" };
  if (typeof result !== "boolean") {
    return {
      decision: "block",
      blockReasons: [{
        code: "camera_kit_check_invalid",
        message: "套装附件齐全必须明确选择“是”或“否”",
        evidence: { resultType: typeof result, bundles: kitLines(subject) }
      }]
    };
  }
  if (result === true) return { decision: "allow" };

  if (point === "pickup_delivery") {
    return {
      decision: "block",
      blockReasons: [{
        code: "camera_kit_incomplete",
        message: `套装（${kitLines(subject)}）附件不齐，不能交付；请补齐附件或调整配货`,
        evidence: { bundles: kitLines(subject), kitComplete: false }
      }]
    };
  }

  const missingException = (subject.exceptions ?? []).find((exception) =>
    typeof exception.code === "string" && MISSING_KIT_EXCEPTION_CODES.has(exception.code.trim().toLowerCase())
  );
  if (!missingException) {
    return {
      decision: "block",
      blockReasons: [{
        code: "camera_kit_missing_exception",
        message: "归还检查发现套装附件不齐，请先记录缺件/附件异常，再继续归还",
        evidence: { bundles: kitLines(subject), kitComplete: false }
      }]
    };
  }
  return {
    decision: "warn",
    notices: [{
      code: "camera_kit_incomplete_recorded",
      message: "套装附件不齐，已记录缺件异常；本批资源将按现有异常隔离与养护流程处理",
      evidence: { bundles: kitLines(subject), exceptionCode: missingException.code ?? "missing_item" }
    }]
  };
}

export function buildCameraKitHandoverHookModule(
  implementationVersion = CAMERA_KIT_HANDOVER_RULESET_VERSION
): RentalCapabilityHookModule {
  const evaluate = (point: "pickup_delivery" | "return_inspection", subject: CameraKitHandoverSubject) =>
    evaluateKitHandover(point, subject);
  return {
    code: "camera_kit_handover",
    implementationVersion,
    order: 30,
    hooks: {
      pickup_delivery: (context) => evaluate("pickup_delivery", context.subject as CameraKitHandoverSubject),
      return_inspection: (context) => evaluate("return_inspection", context.subject as CameraKitHandoverSubject)
    }
  };
}
