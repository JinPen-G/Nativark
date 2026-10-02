"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { AI_TOOL_BASELINE } = require("../apps/api/src/modules/ai-native/tool-baseline");
const { requiredPermissions } = require("../apps/api/src/common/api-auth.guard");
const root = path.resolve(__dirname, "..");

function routeOf(entry) {
  const source = ts.createSourceFile(entry.controllerFile, fs.readFileSync(path.join(root, entry.controllerFile), "utf8"), ts.ScriptTarget.Latest, true);
  const decorators = node => ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  const decorator = (node, name) => decorators(node).map(row => row.expression)
    .find(row => ts.isCallExpression(row) && row.expression.getText(source) === name);
  for (const declaration of source.statements.filter(ts.isClassDeclaration)) {
    const prefix = decorator(declaration, "Controller");
    const member = declaration.members.find(row => row.name?.getText(source) === entry.controllerMethod);
    if (!prefix || !member) continue;
    const route = decorator(member, entry.method === "GET" ? "Get" : "Post");
    if (!route) continue;
    assert.ok(ts.isStringLiteral(prefix.arguments[0]));
    assert.ok(ts.isStringLiteral(route.arguments[0]));
    return `/${prefix.arguments[0].text}/${route.arguments[0].text}`;
  }
  assert.fail(`Missing controller route: ${entry.controllerFile}#${entry.controllerMethod}`);
}

test("all planned families are inventoried without enabling any AI tool", () => {
  assert.equal(AI_TOOL_BASELINE.length, 14);
  assert.equal(new Set(AI_TOOL_BASELINE.map(row => row.code)).size, 14);
  for (const row of AI_TOOL_BASELINE) {
    assert.equal(row.aiMaturity, "unavailable", row.code);
    assert.equal(row.version, "baseline-1");
    assert.ok(row.blockers.length > 0);
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.blockers));
    assert.ok(Object.isFrozen(row.sideEffects));
    assert.equal("handler" in row, false);
    if (row.risk !== "R0") assert.ok(row.sideEffects.length > 0, row.code);
    if (row.entry) {
      assert.ok(Object.isFrozen(row.entry));
      assert.ok(Object.isFrozen(row.entry.permissionAnyOf));
    }
  }
  assert.ok(Object.isFrozen(AI_TOOL_BASELINE));
  assert.throws(() => AI_TOOL_BASELINE.push({ code: "arbitrary.sql" }), TypeError);
  assert.throws(() => { AI_TOOL_BASELINE[0].aiMaturity = "executable"; }, TypeError);
});

test("reuse candidates match actual decorated routes and legacy permission gates", () => {
  for (const row of AI_TOOL_BASELINE.filter(row => row.entry)) {
    const entry = row.entry;
    assert.equal(routeOf(entry), entry.path, row.code);
    const concretePath = entry.path.replace(/:(?:id|code)/g, "baseline-resource");
    assert.deepEqual(requiredPermissions(entry.method, concretePath), entry.permissionAnyOf, row.code);
  }
});

test("quote persistence, member scope and governance preview are not misrepresented", () => {
  const byCode = code => AI_TOOL_BASELINE.find(row => row.code === code);
  assert.equal(byCode("rental.quote.preview").risk, "R1");
  assert.match(byCode("rental.quote.preview").sideEffects.join(" "), /Persists.*quote/);
  assert.equal(byCode("membership.customer.resolve").scope, "tenant");
  assert.equal(byCode("rental.order.commit").risk, "R2");
  assert.equal(byCode("platform.category.propose").businessMaturity, "preview_only");
  for (const row of AI_TOOL_BASELINE.filter(row => row.businessMaturity === "not_implemented")) {
    assert.equal(row.entry, undefined, `${row.code}: do not invent a formal endpoint`);
  }
});
