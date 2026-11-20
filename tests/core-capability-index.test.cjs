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

test("继承配置定位真实AI出口，越界、链接和不可读配置保留未解析", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json");
  const rentalPackageFile = path.join(root, "apps/rental-api/package.json");
  const aiConfigFile = path.join(root, "apps/rental-api/tsconfig.ai.json");
  const baseConfigFile = path.join(root, "apps/rental-api/tsconfig.json");
  const emittedFile = path.join(root, "apps/rental-api/dist-ai/ai-app.module.js");
  const originalRead = fs.readFileSync, originalStat = fs.statSync, originalLstat = fs.lstatSync;
  const metadata = JSON.parse(originalRead(packageFile, "utf8"));
  const rentalMetadata = JSON.parse(originalRead(rentalPackageFile, "utf8"));
  const aiConfig = JSON.parse(originalRead(aiConfigFile, "utf8"));
  const fileStat = originalStat(baseConfigFile);
  let scenario, forbiddenReads = 0;
  fs.statSync = (file, ...args) => typeof file === "string" && path.resolve(file) === scenario?.extends
    ? fileStat : originalStat(file, ...args);
  fs.lstatSync = (file, ...args) => {
    const resolved = typeof file === "string" ? path.resolve(file) : undefined;
    if (resolved === emittedFile) return fileStat;
    if (scenario?.linked && resolved === baseConfigFile) return { isSymbolicLink: () => true };
    return originalLstat(file, ...args);
  };
  fs.readFileSync = (file, options) => {
    if (typeof file !== "string") return originalRead(file, options);
    const resolved = path.resolve(file);
    let text;
    if (resolved === packageFile) text = JSON.stringify({ ...metadata, workspaces: ["apps/rental-api"] });
    else if (resolved === rentalPackageFile) text = JSON.stringify({ ...rentalMetadata,
      exports: { "./ai-app-module": rentalMetadata.exports["./ai-app-module"] } });
    else if (resolved === aiConfigFile && scenario?.extends) text = JSON.stringify({ ...aiConfig, extends: scenario.extends });
    else if (resolved === scenario?.extends) {
      forbiddenReads++;
      text = JSON.stringify({ compilerOptions: { rootDir: path.join(root, "apps/rental-api/src") } });
    } else if (resolved === baseConfigFile && scenario?.unreadable) {
      throw Object.assign(new Error("配置读取被拒绝"), { code: "EACCES" });
    } else if (resolved === emittedFile) text = "throw new Error('生成物不能作为源码或执行');";
    else return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root);
    const capability = index.capabilities.find(item =>
      item.id === "export:@rental-os/rental-api/ai-app-module:RentalAiAppModule");
    assert.ok(capability);
    assert.equal(capability.sources[0].path, "apps/rental-api/src/ai-app.module.ts");
    assert.equal(index.issues.some(issue => issue.code === "export_source"), false);
    for (scenario of [
      { extends: path.resolve(root, "../outside-tsconfig.json") },
      { extends: path.join(root, "node_modules/blocked-tsconfig.json") },
      { linked: true },
      { unreadable: true }
    ]) {
      const rejected = buildRepositoryCapabilityIndex(root);
      assert.ok(rejected.issues.some(issue => issue.code === "export_source"), JSON.stringify(scenario));
      assert.equal(rejected.capabilities.some(item => item.entry?.module === "@rental-os/rental-api/ai-app-module"), false);
    }
    assert.equal(forbiddenReads, 0);
  } finally {
    fs.readFileSync = originalRead;
    fs.statSync = originalStat;
    fs.lstatSync = originalLstat;
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
