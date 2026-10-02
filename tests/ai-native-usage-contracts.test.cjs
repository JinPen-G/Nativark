"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: c01 } = require("../apps/api/src/contracts/ai-native-schemas"), { AI_GATEWAY_DRAFT_SCHEMAS: c03 } = require("../packages/shared/src/ai-gateway-draft-schemas"), { AI_USAGE_DRAFT_SCHEMAS: schemas } = require("../packages/shared/src/ai-usage-draft-schemas"), f = require("./fixtures/ai-native/usage-contracts.cjs");
const base = { ...c01, ...c03 }, validators = h.validatorsFor(schemas, base), yes = (n, x) => assert.equal(validators[n](x), true, JSON.stringify(validators[n].errors)), no = (n, x) => assert.equal(validators[n](x), false, n);
test("C07 closed references compose C01/C03 without billing or runtime admission", () => h.checkClosed(schemas, { ...base, ...schemas }));
for (const quantity of f.quantities) test(`C07 ${quantity.unit} quantity cannot mix units`, () => {
  yes("AiUsageQuantityDraft", quantity); no("AiUsageQuantityDraft", { ...quantity, value: -1 });
  no("AiUsageQuantityDraft", quantity.unit === "money" ? { ...quantity, amount: 1.5 } : { ...quantity, amount: "1.000000", currency: "CNY" });
});
test("C07 fixed precision money rejects float/scientific/negative/nonfinite and unspecified currency", () => {
  const money = f.quantities[2];
  for (const amount of ["-1.000000", "NaN", "Infinity", "1e2", "1.2", "01.000000", "1.0000000", 1, NaN, Infinity]) no("AiUsageQuantityDraft", { ...money, amount });
  for (const patch of [{ currency: "" }, { scale: 2 }, { currency: "cny" }]) no("AiUsageQuantityDraft", { ...money, ...patch });
  yes("AiUsageQuantityDraft", { ...money, amount: "999999999999.999999" });
});
for (const budget of f.budgets) test(`C07 budget ${budget.state} is not unlimited`, () => {
  yes("AiBudgetLimitDraft", budget); no("AiBudgetLimitDraft", { ...budget, unlimited: true });
  if (budget.state === "limited") no("AiBudgetLimitDraft", { ...budget, quantity: { unit: "tokens", value: 0 } });
  if (budget.state === "zero") no("AiBudgetLimitDraft", { ...budget, quantity: { unit: "tokens", value: 1 } });
});
test("C07 money zero and positive quota are separate", () => {
  yes("AiBudgetLimitDraft", { state: "zero", quantity: { ...f.quantities[2], amount: "0.000000" } });
  no("AiBudgetLimitDraft", { state: "limited", quantity: { ...f.quantities[2], amount: "0.000000" } });
});
for (const operation of ["retain", "replace", "clear"]) test(`C07 management secret ${operation}, never gateway/model authority`, () => {
  const secretChange = operation === "replace" ? f.input.secretChange : { operation };
  yes("AiTenantModelSettingsInputDraft", { ...f.input, secretChange });
  no("AiTenantModelSettingsInputDraft", { ...f.input, secretChange: { operation, token: "forged" } });
});
test("C07 tenant-selected endpoint/model management has revision, summary never reveals key", () => {
  yes("AiTenantModelSettingsSummaryDraft", f.summary); yes("AiUsageSettingsDraft", f.setting);
  no("AiTenantModelSettingsSummaryDraft", { ...f.summary, apiKey: "secret" });
  for (const baseUrl of ["http://example.test", "https://user:pass@example.test", "https://example.test?key=secret", "https://example.test#secret"]) no("AiTenantModelSettingsInputDraft", { ...f.input, baseUrl });
  no("AiTenantModelSettingsInputDraft", { ...f.input, expectedRevision: -1 });
  no("AiTenantModelSettingsInputDraft", { ...f.input, secretChange: { operation: "replace", apiKey: "key\r\nheader" } });
  no("AiTenantModelSettingsInputDraft", { ...f.input, secretChange: { operation: "replace", apiKey: "   " } });
  no("AiUsageSettingsDraft", { ...f.setting, budget: { state: "unlimited" } });
  no("AiUsageSettingsDraft", { ...f.setting, scope: h.scope });
});
for (const record of f.records) test(`C07 ledger ${record.status} protocol`, () => {
  yes("AiUsageRecordDraft", record); no("AiUsageRecordDraft", { ...record, authorizationGranted: true });
  no("AiUsageRecordDraft", { ...record, revision: 0 });
  if (record.status === "pending_reconciliation") { no("AiUsageRecordDraft", { ...record, retained: { unit: "tokens", value: 0 } }); no("AiUsageRecordDraft", { ...record, actual: { unit: "tokens", value: 0 } }); no("AiUsageRecordDraft", { ...record, nextAction: "release" }); }
  if (record.status === "released") no("AiUsageRecordDraft", { ...record, reason: "unknown_usage" });
});
for (const mutation of f.mutations) test(`C07 ${mutation.status}/${mutation.reason ?? "record"} protocol only, not DB dedup proof`, () => {
  yes("AiUsageMutationResultDraft", mutation); no("AiUsageMutationResultDraft", { ...mutation, draftVersion: "v0" });
  if (mutation.status === "conflict") no("AiUsageMutationResultDraft", { ...mutation, record: f.records[1] });
});
test("C07 TS consumers cover all quantities/limits/secrets/ledger/conflicts and reject unsafe variants", () => {
  assert.deepEqual(h.compileConsumer(`import type { AiUsageQuantityDraft, AiBudgetLimitDraft, AiTenantModelSettingsInputDraft, AiTenantModelSettingsSummaryDraft, AiUsageSettingsDraft, AiUsageRecordDraft, AiUsageMutationResultDraft } from "../packages/shared/src/ai-usage-draft";
const quantities: AiUsageQuantityDraft[] = ${JSON.stringify(f.quantities)};
const budgets: AiBudgetLimitDraft[] = ${JSON.stringify(f.budgets)};
const input: AiTenantModelSettingsInputDraft = ${JSON.stringify(f.input)};
const summary: AiTenantModelSettingsSummaryDraft = ${JSON.stringify(f.summary)};
const settings: AiUsageSettingsDraft = ${JSON.stringify(f.setting)};
const records: AiUsageRecordDraft[] = ${JSON.stringify(f.records)};
const mutations: AiUsageMutationResultDraft[] = ${JSON.stringify(f.mutations)};
// @ts-expect-error no unbounded budget
const unlimited: AiBudgetLimitDraft = { state: "unlimited" };
// @ts-expect-error zero budget is literally zero
const notZero: AiBudgetLimitDraft = { state: "zero", quantity: { unit: "tokens", value: 1 } };
// @ts-expect-error money must be decimal string
const float: AiUsageQuantityDraft = { unit: "money", amount: 1.5, currency: "CNY", scale: 6 };
// @ts-expect-error summary does not contain secret
const leak: AiTenantModelSettingsSummaryDraft = { ...summary, apiKey: "secret" };
// @ts-expect-error unknown is not settled actual usage
const unknown: AiUsageRecordDraft = { ...records[1], status: "settled", usage: { kind: "unknown", reason: "not_returned", nextAction: "reconcile" } };
`), []);
});
