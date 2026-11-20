"use strict";
/** 原处理器/文档和真实 SQL 字节的离线合同回归。包内执行入口是格式夹具，
 * 从不执行、不写盘、不称为可发布构建或已部署实例。 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path");
const { createRentalHostOpenApi, createRentalHostOpenApiContribution } = require("../dist/openapi.js");
const { createRentalHostHttpPolicy } = require("../dist/http-policy.js");
const { createRentalHostPackage } = require("../dist/package.js");
const { createRentalOpenApi } = require("@rental-os/rental-core/http-openapi");
const { readRentalDataPackage } = require("@rental-os/rental-core/data-package");
const { RENTAL_DATA_MIGRATIONS } = require("@rental-os/rental-core/data");
const { readCoreArchive, createCoreArchive } = require("@rental-os/core-contracts/archive");
const { createCoreMigrationDeployment } = require("@rental-os/core-contracts/deployment");
const { createPublicPlatformDataPlan } = require("@rental-os/platform-api/data-plan");
const root = path.resolve(__dirname, "../../..");
const source = { repository: "https://example.invalid/offline/package-fixture", commit: "a".repeat(40) };
const host = { platform: "0.1.0", contract: "0.1.1", node: "22.12.0", capabilities: {} };
const read = file => fs.readFileSync(path.join(root, file));
const hostContribution = createRentalHostOpenApiContribution();
const platform = createPublicPlatformDataPlan();

function fixture() {
  const metadata = { name: "@rental-os/rental-core", version: "0.1.0", license: "MIT", main: "dist/index.js", types: "dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } };
  const files = new Map([
    ["package.json", Buffer.from(JSON.stringify(metadata))], ["dist/index.js", Buffer.from('throw Error("format fixture must not execute");')],
    ["dist/index.d.ts", Buffer.from("export {};\n")], ["dist/server.js", Buffer.from('throw Error("format fixture must not execute");')],
    ["admin/index.tsx", Buffer.from("export {};\n")], ["README.md", Buffer.from("离线格式夹具")], ["LICENSE", Buffer.from("MIT")],
    ["prisma/schema.prisma", read("packages/rental-core/prisma/schema.prisma")],
    ["prisma/migrations/migration_lock.toml", read("packages/rental-core/prisma/migrations/migration_lock.toml")],
    ...RENTAL_DATA_MIGRATIONS.map(item => [item.file, read(`packages/rental-core/${item.file}`)])
  ]);
  return { files, source, sourceDirectory: "packages/rental-core", platformSource: source,
    platformGuide: read("packages/core-contracts/README.md").toString("utf8"), host };
}
const packaged = createRentalHostPackage(fixture());
const archived = readCoreArchive(packaged.bytes, packaged.sha256);
const lock = { lockVersion: 1, platform: { versions: host, source, sha256: "b".repeat(64), data: platform.data },
  cores: [{ manifest: packaged.manifest, sha256: packaged.sha256 }] };

test("宿主逐条核原挂载，贡献保留 namespace、原合同缺项和当前可用性", () => {
  const policy = createRentalHostHttpPolicy();
  assert.equal(policy.routes.length, 576);
  assert.equal(hostContribution.legacyRoutes.length, 573);
  assert.equal(hostContribution.documentationGaps.length, 4);
  const document = createRentalHostOpenApi(lock, policy);
  const operations = Object.values(document.paths).flatMap(Object.values).filter(value => value.operationId?.startsWith("rental."));
  assert.equal(operations.length, 573);
  assert.equal(operations.filter(value => value["x-schemaStatus"] === "incomplete").length, 292);
  assert.equal(document.paths["/api/rental/v1/orders/{id}"].get["x-coreDisabledRecovery"], "history");
  assert.equal(document["x-rentalDocumentationGaps"].find(item => item.source === "StaffUploadsController.bindInspectionEvidence").availability, "unavailable");
  assert.equal(document.paths["/api/platform/tenant-bootstrap/category-options"], undefined);
});

test("实际清单缺失 OpenAPI、移除真实处理器或加入未知处理器不能沿用文档许可", () => {
  const missing = structuredClone(lock); delete missing.cores[0].manifest.entries.openapi;
  assert.throws(() => createRentalHostOpenApi(missing), /OpenAPI/);
  assert.throws(() => createRentalHostOpenApi({ ...lock, cores: [] }), /单 Core/);
  const policy = createRentalHostHttpPolicy();
  assert.throws(() => createRentalHostOpenApiContribution({ ...policy,
    routes: policy.routes.filter(route => route.handlerName !== "order") }), /唯一实际挂载/);
  assert.throws(() => createRentalHostOpenApiContribution({ ...policy,
    routes: [...policy.routes, { ...policy.routes[0], path: "/rental/v1/unknown", handlerName: "unknown" }] }), /新增未描述/);
});

test("宿主包写入真实贡献；默认及方法不匹配的旧路由例外仍拒绝", () => {
  assert.equal(packaged.manifest.entries.openapi, "dist/http-openapi.json");
  assert.deepEqual(packaged.data.openapi, JSON.parse(JSON.stringify(createRentalOpenApi())));
  assert.throws(() => readRentalDataPackage(archived.files, lock.cores[0], host), /固定|锁定|摘要|不一致/);
  assert.throws(() => readRentalDataPackage(archived.files, lock.cores[0], host,
    hostContribution.legacyRoutes.map(route => route.replace(/^GET /, "POST "))), /不一致/);
  const data = readRentalDataPackage(archived.files, lock.cores[0], host, hostContribution.legacyRoutes);
  assert.deepEqual(data.manifest, packaged.manifest);
  const input = fixture(); input.files.set("dist/http-openapi.json", Buffer.from("{}"));
  assert.throws(() => createRentalHostPackage(input), /不能覆盖/);
});

test("迁移准备透传宿主许可且保留原 SQL 字节、顺序和 prepared 边界", () => {
  const publicMigrations = platform.migrationNames.map((name, index) => ({ name,
    sql: read(`apps/platform-api/${platform.data.migrations[index].file}`) }));
  const input = { lock, platform: publicMigrations, cores: new Map([["rental", archived.files]]) };
  assert.throws(() => createCoreMigrationDeployment(input), /与部署锁不一致/);
  const files = createCoreMigrationDeployment({ ...input, legacyApiRoutes: { rental: hostContribution.legacyRoutes } });
  for (const original of publicMigrations) assert.deepEqual(files.get(`migrations/${original.name}/migration.sql`), original.sql);
  for (const migration of RENTAL_DATA_MIGRATIONS)
    assert.deepEqual(files.get(`migrations/core.rental.${migration.id}/migration.sql`), archived.files.get(migration.file));
  assert.deepEqual(JSON.parse(files.get("core.deployment.lock.json")), lock);
});

test("相同清单但包字节被替换仍拒绝，旧路径许可不放宽摘要", () => {
  const tampered = new Map(archived.files); tampered.set("README.md", Buffer.from("changed"));
  assert.notEqual(createCoreArchive(tampered).sha256, packaged.sha256);
  assert.throws(() => readRentalDataPackage(tampered, lock.cores[0], host, hostContribution.legacyRoutes), /不一致/);
});
