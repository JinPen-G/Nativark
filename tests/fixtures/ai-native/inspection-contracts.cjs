"use strict";
const version = "ain-c09-draft-1";
const sources = [{ kind: "image", attachmentId: "attachment-test", attachmentRevision: 1, region: { x: 0, y: 0, width: 0.5, height: 0.5 } }, { kind: "audio", attachmentId: "recording-test", attachmentRevision: 1, span: { startMs: 0, endMs: 1000 } }];
const values = [{ kind: "number", value: 100 }, { kind: "boolean", value: true }, { kind: "text", value: "Synthetic observation" }, { kind: "select", value: "synthetic-option" }, { kind: "photo", attachmentId: "attachment-test", attachmentRevision: 1 }];
// Codes obtained from actual category definitions at test load; fixture does not invent category rules.
function examples(definitions, scope) {
  return definitions.map(definition => {
    const field = definition.businessModel.defaults.inspectionFields.find(row => row.type === "number") ?? definition.businessModel.defaults.inspectionFields[0];
    const original = { candidateId: "candidate-test", fieldCode: field.code, sources, status: "candidate", value: values.find(row => row.kind === field.type), confidence: 0.8 };
    return { draftVersion: version, draftId: "draft-test", revision: 1, scope, orderId: "order-test", assetId: "asset-test", allocationId: "allocation-test", stage: "return", frozenTemplate: { templateId: "template-test", version: definition.version }, status: "awaiting_review", candidates: [original, { candidateId: "missing-test", fieldCode: field.code, sources: [], status: "missing", reason: "Not visible" }, { candidateId: "blurred-test", fieldCode: field.code, sources: [sources[0]], status: "blurred", reason: "Unreadable" }], corrections: [{ correctionId: "correction-test", candidateId: original.candidateId, expectedDraftRevision: 1, value: original.value, reason: "Synthetic human correction", recordedAt: "2026-10-03T00:00:00Z" }], reviewIssues: ["baseline_missing", "reading_backwards"] };
  });
}
module.exports = { version, sources, values, examples };
