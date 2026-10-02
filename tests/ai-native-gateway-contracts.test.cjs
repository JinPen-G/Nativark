"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require("../apps/api/src/contracts/ai-native-schemas");
const { AI_GATEWAY_DRAFT_SCHEMAS: schemas } = require("../packages/shared/src/ai-gateway-draft-schemas"), f = require("./fixtures/ai-native/gateway-contracts.cjs");
const validators = h.validatorsFor(schemas, base);
const yes = (n, x) => assert.equal(validators[n](x), true, JSON.stringify(validators[n].errors));
const no = (n, x) => assert.equal(validators[n](x), false, `${n} accepted invalid input`);
test("all C03 closed components resolve C01/C02 references without publishing routes", () => h.checkClosed(schemas, { ...base, ...schemas }));
for (const assessment of f.assessments) test(`C03 capability ${assessment.status} requires distinct evidence, not connection inference`, () => {
  yes("AiGatewayCapabilityAssessmentDraft", assessment);
  no("AiGatewayCapabilityAssessmentDraft", { ...assessment, connectionSucceeded: true });
  if (assessment.status === "unverified") no("AiGatewayCapabilityAssessmentDraft", { ...assessment, evidence: "live" });
  else { const incomplete = { ...assessment }; delete incomplete.checkedAt; no("AiGatewayCapabilityAssessmentDraft", incomplete); }
  assert.deepEqual(h.compileConsumer(`import type { AiGatewayCapabilityAssessmentDraft } from "../packages/shared/src/ai-gateway-draft"; const assessment: AiGatewayCapabilityAssessmentDraft = ${JSON.stringify(assessment)};`), []);
});
test("tenant-selected protocol and model are independent of requested expectation", () => { yes("AiGatewayCallDraft", f.call); yes("AiGatewayCapabilitiesDraft", f.capabilities); assert.notEqual(f.call.expectation.model, f.call.config.model); });
test("C03 dual mode resolves platform ownership without asking Agent for a model", () => {
  yes("AiGatewayConfigReferenceDraft", f.platformConfig);
  const { model, ...expectation } = f.call.expectation;
  yes("AiGatewayCallDraft", { ...f.call, config: f.platformConfig, expectation });
  no("AiGatewayConfigReferenceDraft", { ...f.platformConfig, configurationScope: f.config.configurationScope });
  no("AiGatewayConfigReferenceDraft", { ...f.config, configurationScope: { kind: "platform" } });
  no("AiGatewayConfigReferenceDraft", { ...f.config, serviceMode: "unknown" });
  for (const feature of ["text", "embedding", "reasoning"]) yes("AiGatewayCapabilitiesDraft", { ...f.capabilities, features: [feature] });
  no("AiGatewayCallDraft", { ...f.call, draftVersion: "ain-c03-draft-1" });
});
for (const kind of ["text", "image", "audio"]) test(`C03 ${kind} content branch requires resource reference not URL`, () => {
  const value = kind === "text" ? { kind, text: "Synthetic" } : { kind, attachmentId: "attachment-test", attachmentRevision: 1 };
  yes("AiGatewayContentDraft", value); no("AiGatewayContentDraft", { ...value, url: "https://untrusted.test" });
  const copy = { ...value }; delete copy[kind === "text" ? "text" : "attachmentId"]; no("AiGatewayContentDraft", copy);
});
for (const usage of f.usages) test(`C03 ${usage.kind} usage stays distinct`, () => {
  yes("AiGatewayUsageDraft", usage); no("AiGatewayUsageDraft", { ...usage, price: 1.5 });
  if (usage.kind === "unknown") { no("AiGatewayUsageDraft", { ...usage, inputTokens: 0 }); no("AiGatewayUsageDraft", { ...usage, nextAction: "retry_later" }); }
  else no("AiGatewayUsageDraft", { ...usage, inputTokens: -1 });
});
for (const result of [f.completed, f.unknown, ...f.failures]) test(`C03 result ${result.status}/${result.error?.code ?? "text"} branch`, () => {
  yes("AiGatewayResultDraft", result); no("AiGatewayResultDraft", { ...result, rawProviderError: "secret" });
  if (result.status === "unknown") { no("AiGatewayResultDraft", { ...result, usage: f.usages[0] }); no("AiGatewayResultDraft", { ...result, error: { ...result.error, retryable: true } }); }
  else if (result.status === "failed") no("AiGatewayResultDraft", { ...result, error: { ...result.error, code: "success" } });
  else { no("AiGatewayResultDraft", { ...result, error: f.unknown.error }); no("AiGatewayResultDraft", { ...result, toolRequests: [{ ...h.request, input: { sql: "arbitrary" } }] }); }
});
for (const event of f.events) test(`C03 stream ${event.kind} is not business success`, () => { yes("AiGatewayStreamEventDraft", event); no("AiGatewayStreamEventDraft", { ...event, sequence: 0 }); no("AiGatewayStreamEventDraft", { ...event, confirmed: true }); });
test("C03 bounds/versions/identity and secrets reject structurally", () => {
  for (const field of ["actor", "audience", "tenantId", "baseUrl", "apiKey", "token", "sql", "command", "budgetApproval"]) no("AiGatewayCallDraft", { ...f.call, [field]: "forged" });
  no("AiGatewayCallDraft", { ...f.call, config: { ...f.config, apiKey: "secret" } });
  no("AiGatewayCallDraft", { ...f.call, draftVersion: "v0" }); no("AiGatewayCallDraft", { ...f.call, maxOutputTokens: 0 }); no("AiGatewayCallDraft", { ...f.call, maxOutputTokens: 32769 });
  no("AiGatewayCallDraft", { ...f.call, messages: [] }); no("AiGatewayCallDraft", { ...f.call, messages: Array(65).fill(f.call.messages[0]) });
  no("AiGatewayContentDraft", { kind: "text", text: "x".repeat(32001) });
  no("AiGatewayCapabilitiesDraft", { ...f.capabilities, features: ["arbitrary_http"] });
  for (const number of [NaN, Infinity, -1, 1.5]) no("AiGatewayUsageDraft", { kind: "reported", inputTokens: number, outputTokens: 0 });
});
test("C03 real TS consumers compile all unions and reject forged model authority", () => {
  const source = `import type { AiGatewayCallDraft, AiGatewayCapabilitiesDraft, AiGatewayResultDraft, AiGatewayStreamEventDraft, AiGatewayUsageDraft } from "../packages/shared/src/ai-gateway-draft";
const call: AiGatewayCallDraft = ${JSON.stringify(f.call)};
const caps: AiGatewayCapabilitiesDraft = ${JSON.stringify(f.capabilities)};
const results: AiGatewayResultDraft[] = ${JSON.stringify([f.completed, f.unknown, ...f.failures])};
const events: AiGatewayStreamEventDraft[] = ${JSON.stringify(f.events)};
const usages: AiGatewayUsageDraft[] = ${JSON.stringify(f.usages)};
const platform: typeof call.config = ${JSON.stringify(f.platformConfig)};
const noModel: AiGatewayCallDraft = { ...call, config: platform, expectation: { configRevision: 1, requiredFeatures: ["tools", "structured_output"], optionalFeatures: ["image"] } };
// @ts-expect-error unknown usage never reports zero
const zero: AiGatewayUsageDraft = { kind: "unknown", reason: "not_returned", nextAction: "reconcile", inputTokens: 0 };
// @ts-expect-error model cannot override credentials
const key: AiGatewayCallDraft = { ...call, apiKey: "secret" };
// @ts-expect-error stream cannot forge approval
const approved: AiGatewayStreamEventDraft = { ...events[0], approved: true };
`; assert.deepEqual(h.compileConsumer(source), []);
});
