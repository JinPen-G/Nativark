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
