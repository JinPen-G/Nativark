"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: native } = require("../apps/api/src/contracts/ai-native-schemas"), { AI_TASK_INPUT_DRAFT_SCHEMAS: taskInput } = require("../packages/shared/src/ai-task-input-draft-schemas"), { RENTAL_CATEGORY_DEFINITIONS: definitions } = require("../packages/shared/src/core"), { AI_INSPECTION_DRAFT_SCHEMAS: schemas } = require("../packages/shared/src/ai-inspection-draft-schemas"), f = require("./fixtures/ai-native/inspection-contracts.cjs");
// Mirror the production composition (contracts/ai-leaf-components.ts): every
// referenced leaf family is registered, so cross-family $refs resolve.
const { AI_TASK_RECOVERY_HTTP_SCHEMAS: recovery } = require('../packages/shared/src/ai-task-recovery-draft');
const componentBase = { ...native, ...taskInput, ...recovery };
const validators = h.validatorsFor(schemas, componentBase), examples = f.examples(definitions, h.scope);
const yes = (n, x) => assert.equal(validators[n](x), true, JSON.stringify(validators[n].errors)), no = (n, x) => assert.equal(validators[n](x), false, n);
test("C09 closed reference closure, no inspection submission handler", () => h.checkClosed(schemas, { ...componentBase, ...schemas }));
for (const [index, draft] of examples.entries()) test(`C09 existing ${definitions[index].code} field example, not template authority`, () => {
  yes("AiInspectionExtractDraft", draft);
  assert.ok(definitions[index].businessModel.defaults.inspectionFields.some(row => row.code === draft.candidates[0].fieldCode));
  for (const status of ["awaiting_review", "pending_submission"]) yes("AiInspectionExtractDraft", { ...draft, status });
  for (const status of ["confirmed", "approved", "submitted", "succeeded"]) no("AiInspectionExtractDraft", { ...draft, status });
});
for (const source of f.sources) test(`C09 ${source.kind} uses bounded resource locator, not URL`, () => {
  yes("AiInspectionSourceDraft", source); no("AiInspectionSourceDraft", { ...source, url: "https://example.test" });
  no("AiInspectionSourceDraft", { ...source, attachmentRevision: 0 });
  if (source.kind === "image") for (const value of [-1, 1.1, NaN, Infinity]) no("AiInspectionSourceDraft", { ...source, region: { ...source.region, x: value } });
  else for (const value of [-1, 1.5, 86400001]) no("AiInspectionSourceDraft", { ...source, span: { ...source.span, startMs: value } });
});
for (const value of f.values) test(`C09 ${value.kind} value does not carry fee or approval`, () => {
  yes("AiInspectionValueDraft", value); no("AiInspectionValueDraft", { ...value, fee: 100 });
  if (value.kind === "number") for (const invalid of [NaN, Infinity, 1e13, "100"]) no("AiInspectionValueDraft", { ...value, value: invalid });
});
test("C09 missing/blurred never invent values; candidate requires source and finite confidence", () => {
  const [candidate, missing, blurred] = examples[0].candidates;
  for (const x of [candidate, missing, blurred]) yes("AiInspectionCandidateDraft", x);
  for (const x of [missing, blurred]) no("AiInspectionCandidateDraft", { ...x, value: f.values[0] });
  no("AiInspectionCandidateDraft", { ...candidate, sources: [] });
  no("AiInspectionCandidateDraft", { ...candidate, confidence: 1.1 });
});
test("C09 correction preserves candidate reference, not actor/approval grants", () => {
  const correction = examples[0].corrections[0]; yes("AiInspectionCorrectionDraft", correction);
  for (const patch of [{ confirmed: true }, { actorId: "forged" }, { expectedDraftRevision: 0 }, { candidateId: "" }]) no("AiInspectionCorrectionDraft", { ...correction, ...patch });
});
test("C09 structural limits and legacy/foreign fields reject", () => {
  const draft = examples[0];
  for (const patch of [{ draftVersion: "v0" }, { scope: { kind: "tenant", tenantId: "tenant-test" } }, { candidates: Array(101).fill(draft.candidates[0]) }, { liability: "customer" }, { confirmedBy: "forged" }, { stage: "exchange" }]) no("AiInspectionExtractDraft", { ...draft, ...patch });
});
test("C09 known runtime gaps are not schema safety claims", () => {
  // JSON Schema cannot compare sibling coordinates/time or resolve frozen template ownership.
  yes("AiInspectionSourceDraft", { ...f.sources[0], region: { x: 0.9, y: 0, width: 0.5, height: 1 } });
  yes("AiInspectionSourceDraft", { ...f.sources[1], span: { startMs: 1000, endMs: 1 } });
  yes("AiInspectionExtractDraft", { ...examples[0], candidates: [{ ...examples[0].candidates[0], fieldCode: "unknown-field" }] });
  // These represent KNOWN GAP: future runtime validation must reject, not accept as safe.
});
test("C09 TS consumers cover source/value/candidate/correction and pending states", () => {
  assert.deepEqual(h.compileConsumer(`import type { AiInspectionSourceDraft, AiInspectionValueDraft, AiInspectionExtractDraft } from "../packages/shared/src/ai-inspection-draft";
const sources: AiInspectionSourceDraft[] = ${JSON.stringify(f.sources)};
const values: AiInspectionValueDraft[] = ${JSON.stringify(f.values)};
const drafts: AiInspectionExtractDraft[] = ${JSON.stringify(examples)};
// @ts-expect-error final business submission is not extraction
const submitted: AiInspectionExtractDraft = { ...drafts[0], status: "submitted" };
// @ts-expect-error arbitrary URL is not attachment reference
const source: AiInspectionSourceDraft = { kind: "image", url: "https://example.test" };
`), []);
});
