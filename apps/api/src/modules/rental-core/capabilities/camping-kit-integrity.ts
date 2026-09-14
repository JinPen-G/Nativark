import {
  RentalInventoryMode,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookResult
} from "@rental-os/shared";

/** CAMP-01A：露营套装完整性规则版本。 */
export const CAMPING_KIT_INTEGRITY_RULESET_VERSION = "camp-kit-1.0";

type KitLine = { inventoryMode?: RentalInventoryMode | string; itemGroupName?: string; quantity?: number };

interface CampingKitSubject {
  order?: { lines?: KitLine[] };
  results?: Record<string, unknown>;
  exceptions?: Array<{ code?: string; description?: string }>;
  inspectionSkipped?: boolean;
}

const MISSING_KIT_EXCEPTION_CODES = new Set([
  "missing_item",
  "missing_accessory",
  "camping_missing_item",
  "kit_incomplete"
]);

function kitLines(subject: CampingKitSubject) {
  return (subject.order?.lines ?? [])
    .filter((line) => line.inventoryMode === RentalInventoryMode.Bundle)
    .map((line) => line.itemGroupName || "露营套装")
    .join("、");
}

function hasBundle(subject: CampingKitSubject) {
  return Boolean(kitLines(subject));
}

function evaluate(
  point: "pickup_delivery" | "return_inspection",
  subject: CampingKitSubject
): RentalCapabilityHookResult {
  if (!hasBundle(subject)) return { decision: "allow" };

  if (subject.inspectionSkipped) {
    return {
      decision: "block",
      blockReasons: [{
        code: "camping_kit_inspection_required",
        message: "露营套装必须完成数量与组件清点后才能领用或归还",
        evidence: { bundles: kitLines(subject), point }
      }]
    };
  }

  const result = subject.results?.count_ok;
  if (typeof result !== "boolean") {
    return {
      decision: "block",
      blockReasons: [{
        code: "camping_kit_check_required",
        message: "露营套装必须明确记录数量与组件是否齐全",
        evidence: { bundles: kitLines(subject), resultType: typeof result, point }
      }]
    };
  }
  if (result === true) return { decision: "allow" };

  if (point === "pickup_delivery") {
    return {
      decision: "block",
      blockReasons: [{
        code: "camping_kit_incomplete",
        message: `露营套装（${kitLines(subject)}）数量或组件不齐，不能领用；请补齐装备或调整配货`,
        evidence: { bundles: kitLines(subject), countOk: false }
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
        code: "camping_kit_missing_exception",
        message: "归还发现露营套装缺件，请先记录缺件异常，再继续归还",
        evidence: { bundles: kitLines(subject), countOk: false }
      }]
    };
  }
  return {
    decision: "warn",
    notices: [{
      code: "camping_kit_incomplete_recorded",
      message: "露营套装缺件已记录，相关装备将进入异常隔离与补件/养护流程",
      evidence: { bundles: kitLines(subject), exceptionCode: missingException.code ?? "missing_item" }
    }]
  };
}

export function buildCampingKitIntegrityHookModule(
  implementationVersion = CAMPING_KIT_INTEGRITY_RULESET_VERSION
): RentalCapabilityHookModule {
  return {
    code: "camping_kit_integrity",
    implementationVersion,
    order: 30,
    hooks: {
      pickup_delivery: (context) => evaluate("pickup_delivery", context.subject as CampingKitSubject),
      return_inspection: (context) => evaluate("return_inspection", context.subject as CampingKitSubject)
    }
  };
}
