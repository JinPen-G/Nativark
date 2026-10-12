import { AI_INSPECTION_DRAFT_VERSION } from "./ai-inspection-draft";
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as int, leafList as list, leafText as text, leafTime, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const coordinate = { type: "number", minimum: 0, maximum: 1 };
const dimension = { type: "number", exclusiveMinimum: 0, maximum: 1 };
const source = { attachmentId: id(), attachmentRevision: int(1) };
const candidate = { candidateId: id(), fieldCode: id() };
const taskId = { ...id(), maxLength: 128 };
export const AI_INSPECTION_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiInspectionRecognitionTaskReference: obj({ orderId: taskId, allocationId: taskId, stage: choice("pickup", "return"),
    templateId: taskId, draftId: taskId, inputId: taskId, expectedRevision: int(1, 999) }),
  AiInspectionRecognitionTaskCancelRequest: obj({ reference: ref("AiInspectionRecognitionTaskReference"), expectedRevision: int(1, 4294967294) }),
  AiInspectionRecognitionTaskResumeRequest: obj({ reference: ref("AiInspectionRecognitionTaskReference"), submission: ref("AiTaskInputSubmissionDraft") }),
  AiInspectionSourceDraft: { oneOf: [obj({ ...source, kind: choice("image"), region: obj({ x: coordinate, y: coordinate, width: dimension, height: dimension }) }), obj({ ...source, kind: choice("audio"), span: obj({ startMs: int(0, 86400000), endMs: int(0, 86400000) }) })] },
  AiInspectionValueDraft: { oneOf: [obj({ kind: choice("number"), value: { type: "number", minimum: -1e12, maximum: 1e12 } }), obj({ kind: choice("boolean"), value: { type: "boolean" } }), obj({ kind: choice("text", "select"), value: text(2000, 0) }), obj({ kind: choice("photo"), ...source })] },
  AiInspectionCandidateDraft: { oneOf: [obj({ ...candidate, sources: list(ref("AiInspectionSourceDraft"), 16, 1), status: choice("candidate"), value: ref("AiInspectionValueDraft"), confidence: coordinate }), obj({ ...candidate, sources: list(ref("AiInspectionSourceDraft"), 16), status: choice("missing", "blurred"), reason: text(512) })] },
  AiInspectionCorrectionDraft: obj({ correctionId: id(), candidateId: id(), expectedDraftRevision: int(1), value: ref("AiInspectionValueDraft"), reason: text(512), recordedAt: leafTime }),
  AiInspectionExtractDraft: obj({ draftVersion: choice(AI_INSPECTION_DRAFT_VERSION), draftId: id(), revision: int(1), scope: ref("AiWorkspaceScope"), orderId: id(), assetId: id(), allocationId: id(), stage: choice("pickup", "return"), frozenTemplate: obj({ templateId: id(), version: text(64) }), status: choice("awaiting_review", "pending_submission"), candidates: list(ref("AiInspectionCandidateDraft"), 100), corrections: list(ref("AiInspectionCorrectionDraft"), 100), reviewIssues: { ...list(choice("baseline_missing", "meter_replaced", "reading_backwards", "field_unavailable", "source_unclear"), 5), uniqueItems: true } })
};
