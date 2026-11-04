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
// Scope and task-observation schemas publish through their original component
// assemblers, not the leaf assembler. Every other exported AI schema family is
// covered here; embedded families may overlap only with identical definitions.
const otherAssemblers = new Set(['AI_SCOPE_DRAFT_SCHEMAS', 'AI_TASK_OBSERVATION_DRAFT_SCHEMAS']);
const normalizeRefs = value => Array.isArray(value) ? value.map(normalizeRefs)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, key === '$ref' && typeof child === 'string' ? child.replace(/^urn:rental:counting:/u, '#/components/schemas/') : normalizeRefs(child)])) : value;
const families = Object.entries(shared).filter(([name, value]) => name.startsWith('AI_') && name.endsWith('SCHEMAS')
  && value && typeof value === 'object' && !otherAssemblers.has(name));
const leaves = families.map(([, value]) => normalizeRefs(value));
const original = {};
for (const leaf of leaves) for (const [name, schema] of Object.entries(leaf)) {
  if (Object.hasOwn(original, name)) assert.deepEqual(original[name], schema, `conflicting shared schema ${name}`);
  else original[name] = schema;
}
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
const dependencies = forAjv(OPENAPI_DOCUMENT.components.schemas);
const rawDependencies = { ...dependencies, ...forAjv(base),
  ...forAjv(require('../apps/api/src/contracts/ai-task-draft-schemas').AI_TASK_DRAFT_COMPONENT_SCHEMAS),
  ...Object.assign({}, ...Object.entries(shared).filter(([name, value]) => name.startsWith('AI_') && name.endsWith('SCHEMAS')
    && value && typeof value === 'object').map(([, value]) => normalizeRefs(value))) };
const comparedRaw = { ...original, ...Object.assign({}, ...[...otherAssemblers].map(name => shared[name])) };
const comparedPublished = Object.fromEntries(Object.keys(comparedRaw).map(name => [name, dependencies[name]]));
const rawValidators = h.validatorsFor(comparedRaw, rawDependencies), publishedValidators = h.validatorsFor(comparedPublished, dependencies);

test("all leaf types/schemas are available through the unique shared entry and OpenAPI components only", () => {
  assert.ok(families.length > 30, 'all current shared contract families must participate');
  assert.deepEqual(Object.keys(published).sort(), Object.keys(original).sort());
  for (const family of otherAssemblers) for (const [name, schema] of Object.entries(shared[family])) {
    assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], convert(schema, name), `${family}/${name}`);
  }
  for (const [name, schema] of Object.entries(published)) {
    assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], schema);
    assert.ok(!Object.hasOwn(base, name), `collision with C01/C02: ${name}`);
  }
  const inspectRefs = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const match = /^#\/components\/schemas\/([A-Za-z][A-Za-z0-9_]*)$/u.exec(value.$ref);
      assert.ok(match && Object.hasOwn(OPENAPI_DOCUMENT.components.schemas, match[1]), `unresolved published reference ${value.$ref}`);
    }
    Object.values(value).forEach(inspectRefs);
  };
  Object.values(published).forEach(inspectRefs);
  const aiOperations = API_CONTRACT_OPERATIONS.filter(row => row.path.includes('/ai-native/') || row.path.startsWith('/api/platform/ai/'));
  assert.ok(aiOperations.length > 0, 'existing AI routes remain explicitly published');
  for (const row of aiOperations) {
    const operation = OPENAPI_DOCUMENT.paths[row.path][row.method];
    assert.ok(operation, `${row.method} ${row.path}`);
    assert.deepEqual(operation['x-requiredPermissions'], row.permissions);
    const schemaRef = schema => typeof schema === 'string' ? { $ref: `#/components/schemas/${schema}` } : schema ?? { type: 'object', additionalProperties: true };
    if (row.requestSchema) assert.deepEqual(operation.requestBody.content['application/json'].schema, schemaRef(row.requestSchema), `request ${row.path}`);
    const response = operation.responses[String(row.successStatus ?? 200)].content[row.rawResponseContentType ?? 'application/json'].schema;
    assert.deepEqual(row.rawResponseContentType ? response : response.properties.data, schemaRef(row.responseSchema), `response ${row.path}`);
    for (const schema of [row.requestSchema, row.responseSchema]) {
      if (typeof schema === 'string') assert.ok(Object.hasOwn(OPENAPI_DOCUMENT.components.schemas, schema), schema);
      else inspectRefs(schema);
    }
  }
  assert.equal(OPENAPI_DOCUMENT.openapi, "3.0.3");
  const types = `import type { AiGatewayCallDraft, AiKnowledgeSourceDraft, AiUsageRecordDraft, AiBusinessEventDraft, AiInspectionExtractDraft } from "../packages/shared/src";
  const source: AiKnowledgeSourceDraft = { kind: "business_fact", fact: ${JSON.stringify(h.fact)} };`;
  assert.deepEqual(h.compileConsumer(types), []);
});

test('both mounted customer surfaces publish every inherited method with exact request and response schemas', () => {
  const http = shared.AI_CLIENT_ENTRY_HTTP_DRAFT;
  const expected = {
    readHostCapabilities: ['AiClientHostCapabilitiesRequest', 'AiClientHostCapabilities'],
    prepareOrderMaterial: ['AiClientOrderMaterialRequest', 'AiClientOrderMaterialReceipt'],
    readOrderMaterialReceipt: ['AiClientOrderMaterialRequest', 'AiClientOrderMaterialReceipt'],
    createTask: ['AiClientTaskReadRequest', 'AiClientTaskCreationReceipt'],
    readTaskCreation: ['AiClientTaskReadRequest', 'AiClientTaskCreationReceipt'],
    prepareQuoteParameters: ['AiClientQuotePreparationRequest', 'AiClientQuotePreparationResponse'],
    readQuotePreparationOperation: ['AiClientQuotePreparationRequest', 'AiClientQuotePreparationReadResponse'],
    confirmQuoteParameters: ['AiClientQuoteConfirmationRequest', 'AiClientQuoteResultReadResponse'],
    readPreparedQuoteOriginal: ['AiClientQuoteConfirmationRequest', 'AiClientQuoteResultReadResponse'],
    readTaskSnapshot: ['AiClientTaskReadRequest', 'AiTaskSnapshotDraft'],
    readTaskEvents: ['AiClientTaskEventsReadRequest', 'AiTaskEventsObservationDraft'],
    requestTaskCancellation: ['AiClientTaskCancelRequest', 'AiClientTaskCancelReceipt'],
    readTaskCancellationReceipt: ['AiClientTaskCancelRequest', 'AiClientTaskCancellationObservation'],
    readTaskCancellationSettlementReceipt: ['AiClientTaskCancelRequest', 'AiClientTaskCancellationObservation'],
    settleTaskUnstartedCancellation: ['AiClientTaskCancelRequest', 'AiClientTaskUnstartedCancellationReceipt'],
    reconcileTaskInputCancellation: ['AiClientTaskCancelRequest', 'AiClientTaskInputCancellationReceipt'],
    readTaskModelResult: ['AiClientTaskReadRequest', 'AiClientTaskModelResultReadResponse'],
    readTaskInput: ['AiClientTaskReadRequest', 'AiClientTaskInputReadResponse'],
    submitTaskInput: ['AiClientTaskInputSubmissionRequest', 'AiClientTaskInputSubmissionReceipt'],
    readTaskInputReceipt: ['AiClientTaskInputSubmissionRequest', 'AiClientTaskInputReceiptReadResponse'],
    continueTaskInput: ['AiClientTaskInputSubmissionRequest', 'AiClientTaskModelControlResponse'],
    startTaskModel: ['AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
    recoverTaskModel: ['AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
    reconcileTaskModel: ['AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
    readTaskAccounting: ['AiClientTaskAccountingRequest', 'AiClientTaskAccountingResponse'],
    reconcileTaskAccounting: ['AiClientTaskAccountingRequest', 'AiClientTaskAccountingResponse'],
    readOrderExplanation: ['AiClientOrderExplanationReadRequest', 'AiClientOrderExplanationReadResponse'],
    readSource: ['AiClientSourceReadRequest', 'AiClientSourceReadResponse'],
    issueAction: ['AiEntryActionRequest', 'AiEntryActionDraft'],
    createBookingDraft: ['AiBookingActionRequest', 'AiBookingCreateResponse'],
    chooseBookingDraft: ['AiBookingChoiceRequest', 'AiBookingChoiceResponse'],
    readBookingDraft: ['AiBookingDraftSelection', 'AiBookingDraft'],
    handoffBookingDraft: ['AiBookingActionRequest', 'AiBookingHandoffResponse'],
    readBookingHandoff: ['AiBookingHandoffSelection', 'AiBookingHandoff'],
    readBookingOperation: ['AiBookingOperationReadRequest', 'AiBookingOperationReadResponse'],
    readBookingAcceptance: ['AiBookingAcceptanceReadRequest', 'AiBookingAcceptanceReadResponse'],
    acceptBookingSubmission: ['AiBookingSubmissionAcceptanceRequest', 'AiBookingSubmissionAcceptance'],
    submitAcceptedBooking: ['AiBookingSubmissionDecision', 'AiBookingSubmissionReceipt'],
    readBookingSubmission: ['AiBookingSubmissionSelection', 'AiBookingSubmissionReceipt'],
  };
  // Parse source rather than boot AppModule (which loads environment files).
  // This proves registration/decorator coverage, not live HTTP authorization.
  const ts = require('typescript');
  const readAst = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const source = readAst('apps/api/src/modules/ai-native/scenes/client-entry.controller.ts');
  const controller = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AiClientEntryController');
  const methods = {};
  for (const member of controller.members) for (const decorator of ts.getDecorators(member) ?? []) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression) || expression.expression.getText(source) !== 'Post') continue;
    const argument = expression.arguments[0];
    assert.ok(ts.isPropertyAccessExpression(argument) && argument.expression.getText(source) === 'AI_CLIENT_ENTRY_HTTP_DRAFT');
    methods[member.name.getText(source)] = http[argument.name.text];
  }
  assert.deepEqual(Object.keys(methods).sort(), Object.keys(expected).sort());
  const mounted = readAst('apps/api/src/modules/ai-native/scenes/standard-client-entry.application.ts');
  const app = fs.readFileSync(path.join(root, 'apps/api/src/app.module.ts'), 'utf8');
  const registered = /controllers:\s*\[([\s\S]*?)\],\s*providers:/u.exec(app)[1].split(',').map(name => name.trim());
  for (const [className, prefix] of [['WebsiteClientEntryController', http.authenticatedBasePath], ['WechatClientEntryController', http.authenticatedWechatBasePath]]) {
    assert.ok(registered.includes(className));
    const child = mounted.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    assert.equal(child.heritageClauses.find(node => node.token === ts.SyntaxKind.ExtendsKeyword).types[0].expression.getText(mounted), 'AiClientEntryController');
    const decorator = ts.getDecorators(child).find(node => ts.isCallExpression(node.expression) && node.expression.expression.getText(mounted) === 'Controller');
    assert.equal(http[decorator.expression.arguments[0].name.text], prefix);
    const rows = API_CONTRACT_OPERATIONS.filter(row => row.path.startsWith(`/api/${prefix}/`));
    assert.equal(rows.length, Object.keys(expected).length);
    for (const [method, schemas] of Object.entries(expected)) {
      const route = `/api/${prefix}/${methods[method]}`, row = rows.find(row => row.path === route && row.method === 'post');
      assert.ok(row, `${className}.${method}`);
      assert.deepEqual([row.requestSchema, row.responseSchema], schemas, route);
      assert.equal(row.authRequired, true);
      assert.deepEqual(row.permissions, [], 'Client identity must not become operator RBAC');
      const published = OPENAPI_DOCUMENT.paths[route].post;
      assert.deepEqual(published.security, [{ bearerAuth: [] }]);
      assert.deepEqual(published.requestBody.content['application/json'].schema, { $ref: `#/components/schemas/${schemas[0]}` });
      assert.deepEqual(published.responses['200'].content['application/json'].schema.properties.data, { $ref: `#/components/schemas/${schemas[1]}` });
    }
  }
});

test('all customer cancellation publications retain the original positive uint64 cursor boundary', () => {
  const max = 18446744073709551615n;
  const cursors = new Set(['', '0', '01', '-1', '1x', '9007199254740993', String(max), String(max + 1n)]);
  for (let digits = 1; digits <= 21; digits++) {
    const power = 10n ** BigInt(digits);
    for (const value of [power - 1n, power, power + 1n, max - power, max + power]) cursors.add(String(value));
  }
  // Exercise both ends of every twenty-digit prefix branch, not just max/max+1.
  for (let index = 1; index < String(max).length; index++) {
    const digit = Number(String(max)[index]);
    if (digit === 0) continue;
    for (const lower of ['0', String(digit - 1)]) for (const tail of ['0', '9'])
      cursors.add(String(max).slice(0, index) + lower + tail.repeat(19 - index));
  }
  const transition = { taskRevision: 2, observedAt: '2026-11-04T00:00:00Z' };
  const receipt = { contractVersion: shared.AI_TASK_DRAFT_VERSION, taskId: 'task-a', ...transition,
    status: 'cancel_requested', cancellation: 'requested_not_rollback', retryable: false, nextAction: 'read_original_task' };
  const cursorRuntime = shared.aiClientTaskCancelReceiptSchema.shape.cursor;
  for (const cursor of cursors) {
    const expected = cursorRuntime.safeParse(cursor).success;
    const payloads = {
      AiClientTaskCancelReceipt: { ...receipt, cursor },
      AiClientTaskInputCancellationReceipt: { ...receipt, cursor, status: 'cancelled',
        cancellation: 'released_input_wait_settled', externalRollback: 'not_claimed' },
      AiClientTaskUnstartedCancellationReceipt: { ...receipt, cursor, status: 'cancelled',
        cancellation: 'unstarted_task_settled', externalRollback: 'not_claimed' },
      AiClientTaskCancellationObservation: { contractVersion: receipt.contractVersion, taskId: receipt.taskId,
        expectedRevision: 1, state: 'observed', transition: { ...transition, cursor, status: 'cancel_requested' },
        execution: 'not_authorized_by_observation', externalRollback: 'not_claimed', retryable: false, nextAction: receipt.nextAction }
    };
    for (const [name, payload] of Object.entries(payloads)) {
      assert.equal(rawValidators[name](payload), expected, `shared ${name} cursor=${cursor}`);
      assert.equal(publishedValidators[name](payload), expected, `OpenAPI ${name} cursor=${cursor}`);
    }
  }
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
  h.contexts.forEach(collect); collect(h.access); collect(h.unknown); collect(h.denied); collect(h.fact); collect(h.request);
  let accepted = 0;
  const covered = new Set();
  for (const name of Object.keys(comparedRaw)) for (const value of candidates) {
    const expected = rawValidators[name](value);
    accepted += Number(expected);
    if (expected) covered.add(name);
    assert.equal(publishedValidators[name](value), expected, `${name} changed validation behavior`);
  }
  assert.ok(accepted > 50, "matrix must exercise accepted inputs as well as rejections");
  console.log(JSON.stringify({ publicationSchemas: Object.keys(comparedRaw).length, fixtureAcceptedSchemas: covered.size,
    schemasWithoutAcceptedFixture: Object.keys(comparedRaw).filter(name => !covered.has(name)),
    boundary: 'publication coverage is not a valid fixture for every contract' }));
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

test("null-only leaves preserve null without accepting a string or weakening unions", () => {
  const raw = { OnlyNull: { type: "null" }, Reference: { oneOf: [{ type: "string", format: "uuid" }, { type: "null" }] } };
  const converted = Object.fromEntries(Object.entries(raw).map(([name, schema]) => [name, convert(schema)]));
  assert.deepEqual(converted.OnlyNull, { type: "string", nullable: true, enum: [null] });
  const a = h.validatorsFor(raw, {}), b = h.validatorsFor(converted, {});
  for (const name of Object.keys(raw)) for (const value of [null, "", "not-an-id", "00000000-0000-4000-8000-000000000001", 0, false, {}, []]) {
    assert.equal(b[name](value), a[name](value), `${name} changed null-only behavior`);
  }
});

test("unsupported constraints and reference siblings fail instead of silently widening schemas", () => {
  for (const schema of [false, null, [], { type: "null", enum: [null] }, { type: ["string", "number"] }, { const: {} }, { const: null }, { const: 1, enum: [2] }, { exclusiveMinimum: true }, { minimum: Infinity }, { minItems: -1 }, { pattern: 42 }, { additionalProperties: null }, { anyOf: [] }, { enum: [] }, { required: ["a", "a"] }, { unevaluatedProperties: false }, { $ref: "https://example.invalid/schema" }, { $ref: "#/components/schemas/AiToolError", description: "ignored" }]) {
    assert.throws(() => convert(schema), TypeError);
  }
});
