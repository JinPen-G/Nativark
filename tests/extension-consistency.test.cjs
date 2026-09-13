const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_CAPABILITY_MODULES
} = require("@rental-os/shared");
const {
  assertRentalCategoryExtensions,
  assertRentalCapabilityRegistry
} = require("../apps/api/src/modules/rental-core/rental-extension-registry");
const { CapabilityHookRuntime } = require("../apps/api/src/modules/rental-core/capability-hook.runtime");

/**
 * CORE-EXT-03：扩展一致性与第五品类门禁。
 *
 * 证明「新增一个品类 + 一个独立能力」只靠**追加注册定义**即可接入，既有四品类与通用流程
 * 一行不改；同时用变异与反向扫描守住五类回归：引用未注册能力、漏依赖、绕过 Guard、
 * 改写历史快照、在 Core 新增品类编码分支。测试夹具全部是本文件内的**候选集**，
 * 绝不写入生产注册表、Seed 或菜单。
 */

const REPO = path.resolve(__dirname, "..");
const ROOT = path.join(REPO, "apps/api/src/modules/rental-core");

// ---- 测试专用第五品类与测试能力（纯夹具，不进生产任何数组） ----
const TEST_CATEGORY_CODE = "test_lab";
const TEST_CAPABILITY_CODE = "test_probe";

/** 从摄影品类克隆出一个合法的第五品类，只改 code/name 并追加测试能力声明。 */
function makeTestCategory(overrides = {}) {
  const camera = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
  const clone = structuredClone(camera);
  clone.code = TEST_CATEGORY_CODE;
  clone.name = "测试专用品类";
  clone.defaultCapabilities = [...camera.defaultCapabilities, TEST_CAPABILITY_CODE];
  // 新品类必须自己声明必选清单，不能继承摄影品类的专属必选能力。
  clone.requiredCapabilities = ["serialized_inventory"];
  return { ...clone, ...overrides };
}

function makeTestCapability(overrides = {}) {
  return {
    code: TEST_CAPABILITY_CODE,
    label: "测试探针能力",
    kind: "category_optional",
    extensionPoints: ["order_validation"],
    applicableCategories: [TEST_CATEGORY_CODE],
    dependsOn: ["serialized_inventory"],
    conflictsWith: [],
    configSchema: [{ key: "threshold", label: "阈值", type: "number", required: true, min: 0, max: 100 }],
    implementationVersion: "test-1.0",
    ...overrides
  };
}

const candidateModules = (capOverrides) => [...RENTAL_CAPABILITY_MODULES, makeTestCapability(capOverrides)];
const candidateCategories = (catOverrides) => [...RENTAL_CATEGORY_DEFINITIONS, makeTestCategory(catOverrides)];

void (async () => {

// ============ 1. 只靠追加注册定义即可接入第五品类 ============
assert.doesNotThrow(
  () => assertRentalCategoryExtensions(candidateCategories(), candidateModules()),
  "新增品类 + 独立能力，只追加注册定义就应通过门禁（不改既有品类与能力）"
);
// 既有四品类定义一行未改：候选集是 prod 的浅拷贝加一个新元素。
assert.equal(RENTAL_CATEGORY_DEFINITIONS.length, 4, "生产品类必须仍是四个，测试品类不得混入");
assert.ok(
  !RENTAL_CATEGORY_DEFINITIONS.some((row) => row.code === TEST_CATEGORY_CODE),
  "测试品类绝不能出现在生产品类定义里"
);
assert.ok(
  !RENTAL_CAPABILITY_MODULES.some((row) => row.code === TEST_CAPABILITY_CODE),
  "测试能力绝不能出现在生产能力注册表里"
);
console.log("  ✓ 接入：追加一个品类 + 一个独立能力即通过门禁，生产四品类与注册表未被触碰");

// ============ 2. 变异：引用未注册能力 / 漏依赖 / 配置不自洽必须报红 ============
// (a) 品类引用了未注册的 capability。
assert.throws(
  () => assertRentalCategoryExtensions(candidateCategories({ defaultCapabilities: ["serialized_inventory", "ghost_capability"] }), candidateModules()),
  /引用了未注册 capability/u,
  "品类引用未注册能力必须报红"
);
assert.throws(
  () => assertRentalCategoryExtensions(candidateCategories({ requiredCapabilities: ["qualification"] }), candidateModules()),
  /未列入 defaultCapabilities/u,
  "必选能力未进入品类声明集必须报红"
);
assert.throws(
  () => assertRentalCategoryExtensions(candidateCategories({ requiredCapabilities: ["camera_compatibility"] }), candidateModules()),
  /不适用于该品类/u,
  "必选能力不适用于当前品类必须报红"
);
// (b) 漏依赖：测试能力依赖一个未注册的 code。
assert.throws(
  () => assertRentalCategoryExtensions(candidateCategories(), candidateModules({ dependsOn: ["nonexistent_dep"] })),
  /依赖未注册的能力/u,
  "能力依赖未注册 code 必须报红"
);
// (c) 漏依赖的另一形态：依赖一个不适用于本品类的能力，该品类永远无法满足依赖。
assert.throws(
  () =>
    assertRentalCategoryExtensions(
      candidateCategories(),
      candidateModules({ applicableCategories: [TEST_CATEGORY_CODE], dependsOn: ["dispatch"] })
    ),
  /不适用于这些品类/u,
  "依赖一个不适用于本品类的能力必须报红（该品类无法满足依赖）"
);
// (d) 配置 schema 不自洽：枚举无可选值 / 数值上下界倒挂。
assert.throws(
  () => assertRentalCapabilityRegistry(candidateModules({ configSchema: [{ key: "mode", label: "模式", type: "enum", required: true }] })),
  /枚举配置项 mode 缺少可选值/u,
  "枚举配置项无可选值必须报红（配置永远填不合法）"
);
assert.throws(
  () => assertRentalCapabilityRegistry(candidateModules({ configSchema: [{ key: "n", label: "N", type: "number", required: true, min: 100, max: 1 }] })),
  /上下界倒挂/u,
  "数值上下界倒挂必须报红"
);
// (e) 自依赖 / 自互斥。
assert.throws(
  () => assertRentalCapabilityRegistry(candidateModules({ dependsOn: [TEST_CAPABILITY_CODE] })),
  /不能依赖自身/u,
  "自依赖必须报红"
);
console.log("  ✓ 变异：未注册引用、必选清单漂移、两类漏依赖、枚举无值、上下界倒挂、自依赖全部报红");

// ============ 3. 反向扫描：测试夹具不得进入生产 Seed / 菜单 / 品类目录 ============
// 生产的品类目录（platform.service 用它 provisioning 与 Seed）只认四个真实品类。
const platformSource = fs.readFileSync(path.join(REPO, "apps/api/src/modules/platform/platform.service.ts"), "utf8");
assert.ok(!platformSource.includes(TEST_CATEGORY_CODE), "provisioning/Seed 源码不得出现测试品类 code");
assert.ok(!platformSource.includes(TEST_CAPABILITY_CODE), "provisioning/Seed 源码不得出现测试能力 code");
// 管理端导航与品类枚举同样不得包含测试夹具。
const navSource = fs.readFileSync(path.join(REPO, "apps/admin/src/app/navigation.tsx"), "utf8");
assert.ok(!navSource.includes(TEST_CATEGORY_CODE) && !navSource.includes(TEST_CAPABILITY_CODE), "管理端导航不得出现测试夹具");
// 共享契约里的品类枚举与能力码常量不得包含测试夹具。
const sharedSource = fs.readFileSync(path.join(REPO, "packages/shared/src/index.ts"), "utf8");
assert.ok(
  !new RegExp(`["']${TEST_CATEGORY_CODE}["']`, "u").test(sharedSource),
  "共享契约不得硬编码测试品类 code"
);
console.log("  ✓ 反向扫描：测试品类与能力未出现在生产 Seed/provisioning、管理端导航与共享契约中");

// ============ 4. 反向扫描：Core 通用流程不得出现品类编码分支 ============
// 通用报价/订单/库存/履约必须对品类无感——按品类硬分叉正是 CORE-EXT 要消灭的东西。
// 判定对象是具体某个品类的**编码字面量**（如 === "camera" 或 === RentalCategoryCode.Vehicle），
// 而不是把 categoryCode 作为数据透传（写快照、传给 Hook 上下文）。
const CORE_FLOW_FILES = [
  "rental-core.service.ts",
  "rental-business.service.ts",
  "rental-order-confirmation.service.ts",
  "capability-hook.runtime.ts"
];
const CATEGORY_BRANCH = /===\s*RentalCategoryCode\.\w+|RentalCategoryCode\.\w+\s*===|===\s*["'](camera|camping|vehicle|construction)["']|["'](camera|camping|vehicle|construction)["']\s*===/u;
for (const file of CORE_FLOW_FILES) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const offenders = source
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.replace(/\/\/.*$/u, ""), no: index + 1 }))
    .filter((row) => CATEGORY_BRANCH.test(row.line));
  assert.equal(
    offenders.length,
    0,
    `${file} 出现按品类编码的分支（Core 通用流程必须对品类无感）：\n` +
      offenders.map((row) => `  L${row.no}: ${row.line.trim()}`).join("\n")
  );
}
console.log("  ✓ 反向扫描：Core 四个通用流程文件均无按品类编码的硬分支");

// ============ 5. 变异：绕过能力 Guard 必须报红 ============
// 直接单元测试 Guard 的能力分支：未启用必须 403、启用才放行。若判据被改成恒真
// （绕过 isEnabled），"未启用必须拒绝"这条立刻变红。
const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");

function guardContext(method, url) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url, headers: { authorization: "Bearer test-token" } })
    })
  };
}
/** 车辆租户管理员的固定会话。isPlatformAdmin=true 让权限判定通过，能力分支照常执行。 */
const vehicleAuthStub = {
  async resolveAccessContext() {
    return {
      user: { id: "u_ext", tenantId: "t_ext", isSaasAdmin: false, isPlatformAdmin: true, permissions: ["*"], mustChangePassword: false },
      workspaceId: "ws_ext",
      hasWorkspaces: true
    };
  },
  async assertLegacyVehicleDomainWorkspace() { /* 允许旧车辆域，聚焦能力判定 */ },
  async getCategoryContext() { return { categoryCode: "vehicle", capabilities: [] }; }
};
const makeGuard = (isEnabled) => new ApiAuthGuard(vehicleAuthStub, { async isEnabled() { return isEnabled; } });

// 未启用 dispatch：能力分支必须拒绝。
await assert.rejects(
  makeGuard(false).canActivate(guardContext("GET", "/api/rental-os/dispatch/board")),
  /未启用该业务能力/u,
  "capability 未启用时 Guard 必须拒绝（这条捕获任何绕过 isEnabled 的改动）"
);
// 启用 dispatch：放行。
assert.equal(
  await makeGuard(true).canActivate(guardContext("GET", "/api/rental-os/dispatch/board")),
  true,
  "capability 已启用时 Guard 必须放行"
);
// 缺少能力服务（装配被改坏）：fail-closed 拒绝，而不是放行。
await assert.rejects(
  new ApiAuthGuard(vehicleAuthStub).canActivate(guardContext("GET", "/api/rental-os/dispatch/board")),
  /能力门禁未就绪/u,
  "缺少能力服务时必须 fail-closed 拒绝，绝不放行"
);
console.log("  ✓ 变异：Guard 能力分支未启用拒绝、已启用放行、缺服务 fail-closed");


// ============ 6. 测试能力「接入即可运行」，且升级不改写在途订单历史 ============
// 用注入的候选注册表登记测试能力的 Hook，证明「只新增注册定义 + 独立模块」即可运行；
// 这同时补上 02B「能力真正执行」与 02D「两版实现升级、在途按原版本」的端到端缺口。
const TEST_TENANT = "t_ext";
const TEST_WS = "ws_ext";
const probeInstance = (version, config = { threshold: 50 }) => ({
  tenantId: TEST_TENANT, workspaceId: TEST_WS, code: TEST_CAPABILITY_CODE, status: "enabled",
  implementationVersion: version, configVersion: "v1", config, revision: 1, createdAt: "", updatedAt: ""
});
const probeCapabilities = (instances) => ({ async enabledInstances() { return instances; } });
/**
 * 测试能力只适用于 test_lab，因此**所有**判定都必须在 test_lab 品类下发起。
 * 早前这里传的是 `vehicle` 并断言执行成功——那等于在验证「运行时不检查适用品类」，
 * 恰好是本轮修掉的 fail-open。跨品类不执行由第 7 节反向验证。
 */
const probeRun = (extra = {}) => ({
  point: "order_confirmation",
  tenantId: TEST_TENANT,
  workspaceId: TEST_WS,
  categoryCode: TEST_CATEGORY_CODE,
  subject: { id: "order_ext", amount: 100 },
  ...extra
});

// 生产注册表**不含** test_probe，因此默认运行时登记它必须失败——证明它不在生产运行时。
assert.throws(
  () => new CapabilityHookRuntime(probeCapabilities([])).register({ code: TEST_CAPABILITY_CODE, implementationVersion: "test-1.0", order: 10, hooks: { order_confirmation: () => ({ decision: "allow" }) } }),
  /未注册的能力/u,
  "测试能力不在生产注册表里，默认运行时必须拒绝登记（不污染生产）"
);

/**
 * 两版实现的**行为不同**，不是同一个 handler 读版本字符串：
 *   test-1.0：只在超阈值时给提示，放行；
 *   test-2.0：超阈值直接阻止（规则收紧）。
 * 只有行为不同，才能证明「在途订单执行的是 v1 而不是 v2」。
 */
const registerProbeV1 = (runtime, calls) =>
  runtime.register({
    code: TEST_CAPABILITY_CODE,
    implementationVersion: "test-1.0",
    order: 10,
    hooks: {
      order_confirmation: (context) => {
        calls.push(`v1:${context.capability.config.threshold}`);
        if (context.subject.amount > context.capability.config.threshold) {
          return {
            decision: "warn",
            notices: [{ code: "over_threshold", message: "金额超过阈值" }],
            feeBases: [{ code: "probe_fee", label: "探针费", amount: 9, currency: "CNY", basis: "超阈值固定 9 元" }]
          };
        }
        return { decision: "allow" };
      }
    }
  });
const registerProbeV2 = (runtime, calls) =>
  runtime.register({
    code: TEST_CAPABILITY_CODE,
    implementationVersion: "test-2.0",
    order: 10,
    hooks: {
      order_confirmation: (context) => {
        calls.push(`v2:${context.capability.config.threshold}`);
        if (context.subject.amount > context.capability.config.threshold) {
          return { decision: "block", blockReasons: [{ code: "over_threshold_v2", message: "v2 起超阈值一律阻止" }] };
        }
        return { decision: "allow" };
      }
    }
  });

const registry = candidateModules();

// 6a. 接入即运行：注入候选注册表后即可登记并真的执行，产物进入合并结论。
{
  const calls = [];
  const runtime = new CapabilityHookRuntime(probeCapabilities([probeInstance("test-1.0")]), undefined, registry);
  registerProbeV1(runtime, calls);
  const outcome = await runtime.run(probeRun());
  assert.deepEqual(calls, ["v1:50"], "接入的测试能力必须真的被执行，且看到自己的配置");
  assert.deepEqual(outcome.executed.map((row) => row.capability), [TEST_CAPABILITY_CODE], "executed 必须含测试能力");
  assert.equal(outcome.executed[0].implementationVersion, "test-1.0");
  assert.equal(outcome.notices[0]?.code, "over_threshold", "测试能力的提示必须进入合并结论");
  assert.equal(outcome.feeBases[0]?.amount, 9, "测试能力的费用依据必须进入合并结论");
  assert.equal(outcome.blocked, false, "v1 的行为是放行");
}

// 6b. 升级隔离（行为可分辨）：当前实例升到 test-2.0，在途订单固化的是 test-1.0。
{
  const calls = [];
  // 两版实现同时登记——旧版必须保留，否则引用它的在途订单会 fail-closed。
  const runtime = new CapabilityHookRuntime(probeCapabilities([probeInstance("test-2.0")]), undefined, registry);
  registerProbeV1(runtime, calls);
  registerProbeV2(runtime, calls);
  assert.deepEqual(
    runtime.registeredVersions(),
    [`${TEST_CAPABILITY_CODE}@test-1.0`, `${TEST_CAPABILITY_CODE}@test-2.0`],
    "同一能力的两个版本必须共存"
  );

  // 新业务：走当前实例的 test-2.0 → 超阈值被阻止。
  const fresh = await runtime.run(probeRun());
  assert.deepEqual(calls, ["v2:50"], "新业务必须执行升级后的 v2 实现");
  assert.equal(fresh.blocked, true, "v2 收紧后新业务被阻止");
  assert.equal(fresh.blockReasons[0].code, "over_threshold_v2");

  // 在途订单：带 test-1.0 快照 → 必须执行 v1 并**放行**（v1 只提示）。
  // 旧实现（按 code 取唯一 handler）在这里会被 v2 阻止，因此这条断言真的有区分力。
  calls.length = 0;
  const inflight = await runtime.run(probeRun({ instances: [probeInstance("test-1.0")] }));
  assert.deepEqual(calls, ["v1:50"], "在途订单必须执行固化快照的 v1 实现");
  assert.equal(inflight.blocked, false, "升级到 v2 不得改写在途订单的判定结果");
  assert.equal(inflight.notices[0]?.code, "over_threshold", "在途订单仍得到 v1 的提示");
  assert.equal(inflight.executed[0].implementationVersion, "test-1.0", "审计记的是实际执行的版本");
}

// 6c. 旧版本未登记（例如被误删）时，引用它的在途订单必须明确失败，不得静默执行 v2。
{
  const calls = [];
  const runtime = new CapabilityHookRuntime(probeCapabilities([probeInstance("test-2.0")]), undefined, registry);
  registerProbeV2(runtime, calls);
  const outcome = await runtime.run(probeRun({ instances: [probeInstance("test-1.0")] }));
  assert.deepEqual(calls, [], "快照版本缺失时不得退回任何其他版本执行");
  assert.equal(outcome.blocked, true, "快照版本缺失必须 fail-closed");
  assert.equal(outcome.blockReasons[0].code, "capability_implementation_version_missing");
  assert.match(outcome.blockReasons[0].message, /test-1\.0/u);
}

// 6d. 必选能力的 Hook 抛错必须 fail-closed（把测试能力当作必选来验证）。
{
  const requiredRegistry = candidateModules({ kind: "category_required" });
  const runtime = new CapabilityHookRuntime(probeCapabilities([probeInstance("test-1.0")]), undefined, requiredRegistry);
  runtime.register({ code: TEST_CAPABILITY_CODE, implementationVersion: "test-1.0", order: 10, hooks: { order_confirmation: () => { throw new Error("探针故障"); } } });
  const outcome = await runtime.run(probeRun({ subject: { id: "o", amount: 1 } }));
  assert.equal(outcome.blocked, true, "必选测试能力 Hook 抛错必须 fail-closed 阻止");
}
console.log("  ✓ 测试能力接入即运行：v1/v2 行为不同可分辨，在途走 v1、新业务走 v2、缺版本 fail-closed、必选故障 fail-closed");

// ============ 7. 反向隔离：测试能力不得在其他品类上执行 ============
// 第五品类接入的另一半——正向能跑不代表没漏到别处。运行时必须**独立**校验适用品类，
// 不能只依赖「启用接口不让启」：一条脏实例或脏快照就能绕过启用接口。
{
  for (const categoryCode of ["camera", "camping", "vehicle", "construction"]) {
    const calls = [];
    const runtime = new CapabilityHookRuntime(probeCapabilities([probeInstance("test-1.0")]), undefined, registry);
    registerProbeV1(runtime, calls);
    const outcome = await runtime.run(probeRun({ categoryCode }));
    assert.deepEqual(calls, [], `${categoryCode} 品类下不得执行仅适用于 ${TEST_CATEGORY_CODE} 的测试能力`);
    assert.equal(outcome.blocked, true, `${categoryCode} 品类下必须 fail-closed`);
    assert.equal(outcome.blockReasons[0].code, "capability_not_applicable_to_category");
    assert.match(outcome.blockReasons[0].message, new RegExp(categoryCode, "u"), "错误必须点明是哪个品类");
  }
  // 同一份快照在 test_lab 下必须照常执行——证明上面的拒绝来自品类判定，而不是快照本身无效。
  const calls = [];
  const runtime = new CapabilityHookRuntime(probeCapabilities([probeInstance("test-1.0")]), undefined, registry);
  registerProbeV1(runtime, calls);
  const ok = await runtime.run(probeRun({ categoryCode: TEST_CATEGORY_CODE }));
  assert.deepEqual(calls, ["v1:50"], "同一快照在适用品类下必须执行（否则上面的断言没有区分力）");
  assert.equal(ok.blocked, false);
  console.log("  ✓ 反向隔离：测试能力在四个生产品类上一律拒绝执行，仅在 test_lab 下运行");
}

console.log("\nCORE-EXT-03 扩展一致性与第五品类门禁用例全部通过");
})();
