"use strict";
/** 包出口格式回归；使用正常构建后的真实打包器，不生成文件或运行客户端/业务服务。 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRentalPackage } = require("../dist/package.js");
const packageRoot = path.resolve(__dirname, "..");

// These bytes only reach export validation; they are never a successful package
// or a stand-in for the actual server, data, UI or generated declarations.
function invalidPackage(exports) {
  return {
    sourceDirectory: "packages/rental-core",
    files: new Map([
      ["package.json", Buffer.from(JSON.stringify({ name: "@rental-os/rental-core", version: "0.1.0", license: "MIT", exports }))],
      ["clients/enterprise-portal/OrdersPage.tsx", Buffer.from("export {};")]
    ])
  };
}

test("通配出口名称即使指向具体文件也拒绝，不能让未知页面命中别名", () => {
  assert.throws(() => createRentalPackage(invalidPackage({
    "./clients/enterprise-portal/pages/*": "./clients/enterprise-portal/OrdersPage.tsx"
  })), /出口名称不能包含通配符/);
});

test("具体出口不能指向通配目标，条件出口同样检查", () => {
  assert.throws(() => createRentalPackage(invalidPackage({
    "./clients/enterprise-portal/pages/OrdersPage": { default: "./clients/enterprise-portal/*.tsx" }
  })), /正式出口必须明确/);
});

test("具体页面出口缺少实际目标时拒绝", () => {
  assert.throws(() => createRentalPackage(invalidPackage({
    "./clients/enterprise-portal/pages/Unknown": "./clients/enterprise-portal/Unknown.tsx"
  })), /缺少实际文件 clients\/enterprise-portal\/Unknown\.tsx/);
});

test("门户薄宿主只消费逐项登记的具体页面，类型入口与目标一致", () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const host = path.resolve(packageRoot, "../../apps/enterprise-portal/src");
  const prefix = "./clients/enterprise-portal/pages/";
  const consumers = new Set();
  for (const name of fs.readdirSync(host).filter(name => name.endsWith(".tsx"))) {
    const source = fs.readFileSync(path.join(host, name), "utf8");
    for (const match of source.matchAll(/@rental-os\/rental-core\/clients\/enterprise-portal\/pages\/([A-Za-z0-9_-]+)/g)) {
      consumers.add(prefix + match[1]);
    }
  }
  const declarations = Object.keys(metadata.exports).filter(name => name.startsWith(prefix));
  assert.equal(consumers.size, 36);
  assert.deepEqual(declarations.sort(), [...consumers].sort());
  for (const name of declarations) {
    assert.equal(name.includes("*"), false);
    const target = `./clients/enterprise-portal/${name.slice(prefix.length)}.tsx`;
    assert.equal(metadata.exports[name], target);
    assert.deepEqual(metadata.typesVersions["*"][name.slice(2)], [target.slice(2)]);
    assert.equal(fs.statSync(path.join(packageRoot, target)).isFile(), true);
  }
  for (const name of ["Unknown", "App", "enterprise-session"]) {
    assert.equal(metadata.exports[prefix + name], undefined);
    assert.equal(metadata.typesVersions["*"][(prefix + name).slice(2)], undefined);
  }
});
