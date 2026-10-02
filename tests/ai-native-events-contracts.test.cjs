"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require("../apps/api/src/contracts/ai-native-schemas"), { AI_EVENTS_DRAFT_SCHEMAS: schemas } = require("../packages/shared/src/ai-events-draft-schemas"), { AI_TOOL_CODES } = require("../packages/shared/src/ai-native"), f = require("./fixtures/ai-native/events-contracts.cjs");
const validators = h.validatorsFor(schemas, base), yes = (n, x) => assert.equal(validators[n](x), true, JSON.stringify(validators[n].errors)), no = (n, x) => assert.equal(validators[n](x), false, n);
test("C08 schema is closed business input, not task UI event or scheduler", () => h.checkClosed(schemas, { ...base, ...schemas }));
for (const event of f.events) test(`C08 event ${event.type} minimal payload and resource binding shape`, () => {
  yes("AiBusinessEventDraft", event); no("AiBusinessEventDraft", { ...event, type: "arbitrary.business_event" });
  no("AiBusinessEventDraft", { ...event, resource: { ...event.resource, kind: "anything" } });
  no("AiBusinessEventDraft", { ...event, payload: { ...event.payload, fullSnapshot: { privateCustomer: "secret" } } });
  no("AiBusinessEventDraft", { ...event, eventVersion: "0" });
});
for (const delivery of f.deliveries) test(`C08 delivery ${delivery.state} expresses recheck/manual rather than repeat action`, () => {
  yes("AiBusinessDeliveryDraft", delivery); no("AiBusinessDeliveryDraft", { ...delivery, attemptsUnlimited: true });
  if (delivery.nextAction) no("AiBusinessDeliveryDraft", { ...delivery, nextAction: "execute_without_read" });
});
for (const mode of ["draft", "disabled", "shadow", "manual_confirmation"]) test(`C08 policy ${mode} never authorizes unattended R3`, () => {
  yes("AiAutomationPolicyDraft", { ...f.policy, mode });
  no("AiAutomationPolicyDraft", { ...f.policy, mode, r3Policy: "auto_execute" });
});
test("C08 tool references bind catalogue version and have no caller-settable risk", () => {
  for (const toolCode of AI_TOOL_CODES) yes("AiAutomationToolReferenceDraft", { ...f.tools[0], toolCode });
  for (const toolCode of ["refund.execute", "arbitrary.sql", "arbitrary.http"]) no("AiAutomationToolReferenceDraft", { ...f.tools[0], toolCode });
  no("AiAutomationToolReferenceDraft", { ...f.tools[0], risk: "R0" });
  no("AiAutomationToolReferenceDraft", { ...f.tools[0], catalogRevision: undefined });
});
test("C08 strict scope/expiry/counters/causal-depth boundaries reject, not runtime loop protection", () => {
  no("AiAutomationPolicyDraft", { ...f.policy, mode: "auto_execute" });
  no("AiAutomationPolicyDraft", { ...f.policy, scope: { kind: "platform" } });
  no("AiAutomationPolicyDraft", { ...f.policy, subject: { ...f.policy.subject, superuser: true } });
  no("AiAutomationPolicyDraft", { ...f.policy, allowedRecipientIds: ["r", "r"] });
  no("AiAutomationPolicyDraft", { ...f.policy, expiresAt: undefined });
  for (const field of Object.keys(f.policy.limits)) no("AiAutomationPolicyDraft", { ...f.policy, limits: { ...f.policy.limits, [field]: field === "maxCausalDepth" ? -1 : 0 } });
  no("AiBusinessEventDraft", { ...f.events[0], causalDepth: 21 });
  no("AiBusinessEventDraft", { ...f.events[0], deduplicationKey: undefined });
});
test("C08 TS all event/delivery/policy branches compile without arbitrary R3 or event input", () => {
  assert.deepEqual(h.compileConsumer(`import type { AiBusinessEventDraft, AiBusinessDeliveryDraft, AiAutomationPolicyDraft, AiAutomationToolReferenceDraft } from "../packages/shared/src/ai-events-draft";
const events: AiBusinessEventDraft[] = ${JSON.stringify(f.events)};
const deliveries: AiBusinessDeliveryDraft[] = ${JSON.stringify(f.deliveries)};
const policy: AiAutomationPolicyDraft = ${JSON.stringify(f.policy)};
const tools: AiAutomationToolReferenceDraft[] = ${JSON.stringify(f.tools)};
// @ts-expect-error no unattended auto-execute
const auto: AiAutomationPolicyDraft = { ...policy, mode: "auto_execute" };
// @ts-expect-error catalogue owns risk
const risk: AiAutomationToolReferenceDraft = { ...tools[0], risk: "R0" };
// @ts-expect-error arbitrary event names unavailable
const unknown: AiBusinessEventDraft = { ...events[0], type: "anything" };
// @ts-expect-error dead letter must use manual exit
const retry: AiBusinessDeliveryDraft = { draftVersion: "${f.version}", eventId: "e", attempt: 1, state: "dead_letter", reason: "attempts_exhausted", nextAction: "execute" };
`), []);
});
