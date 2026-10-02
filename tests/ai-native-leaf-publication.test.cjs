"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const path = require("node:path"), fs = require("node:fs"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@rental-os/shared")).startsWith(fs.realpathSync(path.join(root, "packages/shared")) + path.sep));
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const shared = apiRequire("@rental-os/shared");
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require("../apps/api/src/contracts/ai-native-schemas");
const { AI_LEAF_COMPONENT_SCHEMAS: published } = require("../apps/api/src/contracts/ai-leaf-components");
const { aiLeafToOpenApi30: convert } = require("../apps/api/src/contracts/ai-leaf-openapi");
const { OPENAPI_DOCUMENT, API_CONTRACT_OPERATIONS } = require("../apps/api/src/contracts/openapi-document");
const leaves = [shared.AI_GATEWAY_DRAFT_SCHEMAS, shared.AI_KNOWLEDGE_DRAFT_SCHEMAS, shared.AI_USAGE_DRAFT_SCHEMAS, shared.AI_EVENTS_DRAFT_SCHEMAS, shared.AI_INSPECTION_DRAFT_SCHEMAS];
const original = Object.assign({}, ...leaves);
// AJV consumes JSON Schema, not OpenAPI 3.0's boolean exclusive-bound spelling.
function forAjv(value) {
  if (Array.isArray(value)) return value.map(forAjv);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, forAjv(child)]));
  for (const [exclusive, inclusive] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]]) {
    if (typeof result[exclusive] === "boolean") {
      if (result[exclusive]) { result[exclusive] = result[inclusive]; delete result[inclusive]; }
      else delete result[exclusive];
    }
  }
  return result;
}
const rawValidators = h.validatorsFor(original, base), publishedValidators = h.validatorsFor(forAjv(published), base);

test("all leaf types/schemas are available through the unique shared entry and OpenAPI components only", () => {
  assert.equal(new Set(leaves.flatMap(leaf => Object.keys(leaf))).size, Object.keys(original).length);
  assert.deepEqual(Object.keys(published).sort(), Object.keys(original).sort());
  for (const [name, schema] of Object.entries(published)) {
    assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], schema);
    assert.ok(!Object.hasOwn(base, name), `collision with C01/C02: ${name}`);
  }
  assert.ok(API_CONTRACT_OPERATIONS.every(row => !/\/ai(?:-native)?\//u.test(row.path)));
  assert.equal(OPENAPI_DOCUMENT.openapi, "3.0.3");
  const types = `import type { AiGatewayCallDraft, AiKnowledgeSourceDraft, AiUsageRecordDraft, AiBusinessEventDraft, AiInspectionExtractDraft } from "../packages/shared/src";
  const source: AiKnowledgeSourceDraft = { kind: "business_fact", fact: ${JSON.stringify(h.fact)} };`;
  assert.deepEqual(h.compileConsumer(types), []);
});

test("OpenAPI conversion changes keywords without dropping nested constraints or mutating sources", () => {
  const before = JSON.stringify(original);
  for (const [name, schema] of Object.entries(original)) assert.deepEqual(convert(schema), published[name]);
  assert.equal(JSON.stringify(original), before);
  const walk = node => {
    if (!node || typeof node !== "object") return;
    assert.equal(Object.hasOwn(node, "const"), false);
    for (const exclusive of ["exclusiveMinimum", "exclusiveMaximum"]) if (Object.hasOwn(node, exclusive)) assert.equal(typeof node[exclusive], "boolean");
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(walk) : walk(value));
  };
  Object.values(published).forEach(walk);
  assert.deepEqual(convert({ type: "boolean", const: false }), { type: "boolean", enum: [false] });
  assert.deepEqual(convert({ type: "number", exclusiveMinimum: 0, maximum: 1 }), { type: "number", minimum: 0, exclusiveMinimum: true, maximum: 1 });
  assert.deepEqual(convert({ type: "number", minimum: 2, exclusiveMinimum: 1 }), { type: "number", minimum: 2 });
  assert.deepEqual(convert({ type: "number", maximum: 2, exclusiveMaximum: 3 }), { type: "number", maximum: 2 });
  assert.deepEqual(convert({ type: "number", exclusiveMaximum: 2, maximum: 3 }), { type: "number", maximum: 2, exclusiveMaximum: true });
  assert.deepEqual(convert({ type: "string", writeOnly: true, not: { const: "secret" } }), { type: "string", writeOnly: true, not: { enum: ["secret"] } });
});

test("original and published schemas agree on all nested fixture objects and boundary values", () => {
  const candidates = [null, true, false, 0, 1, -1, "", {}, [], "0.000000", "0.000001"];
  const collect = value => {
    if (typeof value === "function" || value === undefined) return;
    candidates.push(value);
    if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const family of ["gateway", "knowledge", "usage", "events", "inspection"]) collect(require(`./fixtures/ai-native/${family}-contracts.cjs`));
  let accepted = 0;
  for (const name of Object.keys(original)) for (const value of candidates) {
    const expected = rawValidators[name](value);
    accepted += Number(expected);
    assert.equal(publishedValidators[name](value), expected, `${name} changed validation behavior`);
  }
  assert.ok(accepted > 50, "matrix must exercise accepted inputs as well as rejections");
  const raw = { Range: { type: "number", minimum: -1, exclusiveMinimum: 0, maximum: 2, exclusiveMaximum: 1 } };
  const a = h.validatorsFor(raw, {}), b = h.validatorsFor({ Range: forAjv(convert(raw.Range)) }, {});
  for (const value of [-1, 0, Number.EPSILON, 0.5, 1, 2]) assert.equal(b.Range(value), a.Range(value));
});

test("Agent intent supplies capabilities, never a provider, model, credential or identity", () => {
  const g = require("./fixtures/ai-native/gateway-contracts.cjs");
  const intent = { draftVersion: g.version, requestId: "r1", sceneCode: "rental-builder", messages: g.call.messages, requiredFeatures: ["tools", "structured_output"], optionalFeatures: ["image"], maxOutputTokens: 256 };
  assert.equal(publishedValidators.AiGatewayIntentDraft(intent), true);
  for (const key of ["model", "provider", "protocol", "baseUrl", "apiKey", "config", "context", "tenantId", "audience"]) assert.equal(publishedValidators.AiGatewayIntentDraft({ ...intent, [key]: "forged" }), false);
  const source = `import type { AiGatewayIntentDraft, AiGatewayPortDraft, AiExecutionContext } from "../packages/shared/src";
  const intent: AiGatewayIntentDraft = ${JSON.stringify(intent)};
  declare const gateway: AiGatewayPortDraft;
  declare const context: AiExecutionContext;
  gateway.invoke(context, intent); gateway.stream(context, intent);
  // @ts-expect-error no model selection in Agent input
  const pinned: AiGatewayIntentDraft = { ...intent, model: "fixed" };
  // @ts-expect-error no credentials in Agent input
  const secret: AiGatewayIntentDraft = { ...intent, apiKey: "synthetic" };`;
  assert.deepEqual(h.compileConsumer(source), []);
});

test("platform tasks have explicit gateway and usage scope without a fabricated tenant", () => {
  const g = require("./fixtures/ai-native/gateway-contracts.cjs"), u = require("./fixtures/ai-native/usage-contracts.cjs");
  const { tenantId, ...platformFields } = g.platformConfig;
  const config = { ...platformFields, consumerScope: { kind: "platform" } };
  assert.equal(publishedValidators.AiGatewayConfigReferenceDraft(config), true);
  assert.equal(publishedValidators.AiGatewayConfigReferenceDraft(platformFields), false);
  assert.equal(publishedValidators.AiGatewayConfigReferenceDraft({ ...config, tenantId }), false);
  assert.equal(publishedValidators.AiGatewayConfigReferenceDraft({ ...config, serviceMode: "tenant_managed" }), false);
  const call = { ...g.call, context: h.contexts[3], config };
  const association = { ...u.association, scope: { kind: "platform" }, config };
  assert.equal(publishedValidators.AiGatewayCallDraft(call), true);
  assert.equal(publishedValidators.AiUsageAssociationDraft(association), true);
  assert.equal(publishedValidators.AiUsageSettingsDraft({ ...u.setting, scope: { kind: "platform" }, config }), true);
  const source = `import type { AiGatewayConfigReferenceDraft, AiGatewayCallDraft, AiUsageAssociationDraft } from "../packages/shared/src";
  const config: AiGatewayConfigReferenceDraft = ${JSON.stringify(config)};
  const call: AiGatewayCallDraft = ${JSON.stringify(call)};
  const association: AiUsageAssociationDraft = ${JSON.stringify(association)};
  // @ts-expect-error omitted tenant is not implicitly a platform consumer
  const implicit: AiGatewayConfigReferenceDraft = ${JSON.stringify(platformFields)};`;
  assert.deepEqual(h.compileConsumer(source), []);
});

test("unsupported constraints and reference siblings fail instead of silently widening schemas", () => {
  for (const schema of [false, null, [], { type: "null" }, { type: ["string", "null"] }, { const: {} }, { const: null }, { const: 1, enum: [2] }, { exclusiveMinimum: true }, { minimum: Infinity }, { minItems: -1 }, { pattern: 42 }, { additionalProperties: null }, { anyOf: [] }, { enum: [] }, { required: ["a", "a"] }, { unevaluatedProperties: false }, { $ref: "https://example.invalid/schema" }, { $ref: "#/components/schemas/AiToolError", description: "ignored" }]) {
    assert.throws(() => convert(schema), TypeError);
  }
});
