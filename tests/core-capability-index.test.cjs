/** 标准底座显式 workspace 列表的索引回归，仅在内存替换根包配置并只读本仓源码。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRepositoryCapabilityIndex } = require("../packages/core-contracts/dist/repository-index.js");
const { PLATFORM_SOURCE_WORKSPACES } = require("../packages/core-contracts/dist/platform-source.js");

test("标准底座显式 workspace 能定位公共能力及独立 API 消费者", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json");
  const originalRead = fs.readFileSync;
  const metadata = JSON.parse(originalRead(packageFile, "utf8"));
  const fixture = Buffer.from(JSON.stringify({
    ...metadata,
    workspaces: [...PLATFORM_SOURCE_WORKSPACES, "packages/platform-core-host",
      "packages/__core_capability_nested_fixture_missing__/*", "__core_capability_directory_fixture_missing__"]
  }));

  fs.readFileSync = (file, options) => {
    if (typeof file !== "string" || path.resolve(file) !== packageFile) return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? fixture.toString(encoding) : Buffer.from(fixture);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root);
    assert.equal(index.issues.filter(issue => issue.code === "workspace_pattern").length, 0);
    for (const directory of PLATFORM_SOURCE_WORKSPACES) {
      assert.equal(index.capabilities.filter(item => item.id === `module:${directory}`).length, 1);
    }
    assert.ok(index.coverage.some(item =>
      item.source === "packages/__core_capability_nested_fixture_missing__" && item.state === "not_present"));
    assert.ok(index.coverage.some(item =>
      item.source === "__core_capability_directory_fixture_missing__" && item.state === "not_present"));
    const capability = index.capabilities.find(item =>
      item.id === "export:@rental-os/platform-core-host:createPublicCorePackageDeploymentSources");
    assert.ok(capability);
    assert.equal(capability.entry.module, "@rental-os/platform-core-host");
    assert.equal(capability.sources[0].path, "packages/platform-core-host/src/core-package-deployment.ts");
    assert.ok(capability.details.directImports.some(item => item.path === "apps/platform-api/src/core-assembly.ts"));
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("静态API资料定位正则原文与DTO字段，动态校验和缺失引用保持来源", () => {
  const ts = require("typescript");
  const { RepositorySource } = require("../packages/core-contracts/dist/repository-source.js");
  const { describeRepositorySchema, repositoryApiDocumentation } = require("../packages/core-contracts/dist/repository-openapi.js");
  const root = path.resolve(__dirname, "..");
  const file = path.join(root, "packages/core-contracts/src/repository-openapi.ts");
  const originalRead = fs.readFileSync;
  const fixture = String.raw`
const originalPattern = /^[A-Za-z0-9_\/-]{2,64}$/u;
const patternAlias = originalPattern;
const limits = { maxItems: 4, dynamic: () => { throw new Error("must-not-run"); } };
const STATIC_FIELD_SCHEMAS = { Result: { type: "object", properties: { ok: { type: "boolean" } } } };
const STATIC_FIELD_OPERATIONS = [{ method: "POST", path: "/api/static-fields",
  requestSchema: { type: "object", properties: { code: { type: "string", pattern: patternAlias.source }, codes: { type: "array", maxItems: limits.maxItems } } },
  responseSchema: { $ref: "#/components/schemas/Result" } }];
const dynamicSchema = { type: "string", pattern: new RegExp("dynamic").source };
const missingSchema = { $ref: "#/components/schemas/Missing" };
const incompleteSchema = { type: "object", "x-schemaStatus": "incomplete", "x-schemaGaps": ["dynamic-response"] };
class RequestDto { code!: string; items?: Array<{ id: string }>; static marker = "internal"; }
class DerivedDto extends RequestDto { reason?: string; }
class GenericDto<T> { value!: T; }
@Controller("static-fields") class StaticFieldsController {
  @Post() save(@Body() input: RequestDto) {}
  @Post("derived") derived(@Body() input: DerivedDto) {}
  @Post("generic") generic(@Body() input: GenericDto<string>) {}
}
`;
  fs.readFileSync = (source, options) => {
    if (typeof source !== "string" || path.resolve(source) !== file) return originalRead(source, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? fixture : Buffer.from(fixture);
  };
  try {
    const source = new RepositorySource(root, [file], {});
    const documentation = repositoryApiDocumentation(source);
    const operation = documentation.get("POST /api/static-fields");
    assert.equal(operation.details.openapiSource.schemas.requestSchema.schema.properties.code.pattern, "^[A-Za-z0-9_\\/-]{2,64}$");
    assert.equal(operation.details.openapiSource.schemas.requestSchema.schema.properties.codes.maxItems, 4);
    assert.equal(operation.details.openapiSource.schemas.requestSchema.status, "indexed");
    const body = operation.details.controllerRequestBodies[0];
    assert.deepEqual(body.fields.map(field => field.name), ["code", "items"]);
    assert.equal(body.fields[1].declaredType, "Array<{ id: string }>");
    assert.equal(body.status, "source-reference");
    for (const suffix of ["derived", "generic"]) {
      const value = documentation.get(`POST /api/static-fields/${suffix}`);
      assert.equal(value.details.apiFieldsStatus, "source-reference");
      assert.equal(value.details.controllerRequestBodies[0].fieldNamesStatus, "source-reference");
      assert.deepEqual(value.details.controllerSource.issues, ["responseSchema:source-reference"]);
    }
    const declarations = source.source(file).statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]);
    const expression = name => declarations.find(node => node.name.getText() === name).initializer;
    assert.equal(describeRepositorySchema(source, expression("dynamicSchema")).status, "source-reference");
    assert.equal(describeRepositorySchema(source, expression("incompleteSchema")).status, "source-reference");
    const missing = describeRepositorySchema(source, expression("missingSchema"), [expression("STATIC_FIELD_SCHEMAS")]);
    assert.equal(missing.status, "not-indexed");
    assert.equal(missing.references[0].mapSources[0].path, "packages/core-contracts/src/repository-openapi.ts");
    assert.ok(missing.references[0].mapSources[0].line > 0);
  } finally {
    fs.readFileSync = originalRead;
  }
});
