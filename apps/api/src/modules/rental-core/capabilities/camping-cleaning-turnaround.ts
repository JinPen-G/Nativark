import {
  type RentalCapabilityHookModule,
  type RentalCapabilityHookResult
} from "@rental-os/shared";

/** CAMP-01A：露营清洁周转规则版本。 */
export const CAMPING_CLEANING_TURNAROUND_RULESET_VERSION = "camp-clean-1.0";

interface CampingCleaningSubject {
  results?: Record<string, unknown>;
  exceptions?: Array<{ code?: string; description?: string }>;
  inspectionSkipped?: boolean;
}

const CLEANING_EXCEPTION_CODES = new Set([
  "cleaning_required",
  "camping_cleaning_required",
  "camping_deep_cleaning_required"
]);

function evaluate(subject: CampingCleaningSubject): RentalCapabilityHookResult {
  if (subject.inspectionSkipped) {
    return {
      decision: "block",
      blockReasons: [{
        code: "camping_cleaning_inspection_required",
        message: "露营装备归还必须完成清洁状态检查，不能免检放行",
        evidence: { point: "return_inspection" }
      }]
    };
  }

  const cleanliness = subject.results?.cleanliness;
  if (cleanliness !== "良好" && cleanliness !== "需清洁" && cleanliness !== "严重污损") {
    return {
      decision: "block",
      blockReasons: [{
        code: "camping_cleaning_check_invalid",
        message: "露营装备必须记录清洁状态：良好、需清洁或严重污损",
        evidence: { value: typeof cleanliness === "string" ? cleanliness : typeof cleanliness }
      }]
    };
  }
  if (cleanliness === "良好") return { decision: "allow" };

  const expectedCode = cleanliness === "严重污损" ? "camping_deep_cleaning_required" : "camping_cleaning_required";
  const exception = (subject.exceptions ?? []).find((item) =>
    typeof item.code === "string" && CLEANING_EXCEPTION_CODES.has(item.code.trim().toLowerCase())
  );
  if (!exception) {
    return {
      decision: "block",
      blockReasons: [{
        code: "camping_cleaning_exception_required",
        message: cleanliness === "严重污损"
          ? "露营装备严重污损，请先记录深度清洁异常，再进入归还流程"
          : "露营装备需要清洁，请先记录清洁异常，再进入归还流程",
        evidence: { cleanliness, expectedCode }
      }]
    };
  }
  return {
    decision: "warn",
    notices: [{
      code: expectedCode,
      message: cleanliness === "严重污损"
        ? "已记录深度清洁异常，装备将隔离并生成清洁养护工单"
        : "已记录清洁异常，装备将隔离并生成清洁养护工单",
      evidence: { cleanliness, exceptionCode: exception.code ?? expectedCode }
    }]
  };
}

export function buildCampingCleaningTurnaroundHookModule(
  implementationVersion = CAMPING_CLEANING_TURNAROUND_RULESET_VERSION
): RentalCapabilityHookModule {
  return {
    code: "camping_cleaning_turnaround",
    implementationVersion,
    order: 40,
    hooks: { return_inspection: (context) => evaluate(context.subject as CampingCleaningSubject) }
  };
}
