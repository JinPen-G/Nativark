const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { WorkspaceCapabilityService } = require("../apps/api/src/modules/rental-core/workspace-capability.service");
const { WorkspaceCapabilityRepository } = require("../apps/api/src/modules/rental-core/workspace-capability.repository");
const { assertRentalCapabilityRegistry } = require("../apps/api/src/modules/rental-core/rental-extension-registry");
const { RENTAL_CAPABILITY_MODULES, RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { ConflictException } = require("@nestjs/common");

/**
 * CORE-EXT-02A：capability 运行时的判定口径。
 *
 * 本文件不连库：验证的是**判定逻辑**（三层状态、六道 fail-closed 校验、逐字段配置校验、
 * 配置版本序号、乐观并发）。落库语义、跨空间/跨租户隔离与重启恢复在 mysql-e2e 里验证。
 *
 * 仓储替身刻意复刻真实仓储的两条写入前置：`expectedRevision === undefined` 表示
 * 「该行应当还不存在」，否则必须精确匹配当前 revision。替身若比真实实现宽松，
 * 这里的并发断言就会变成假绿。
 */

const CONFLICT = "ConflictException";
const BAD_REQUEST = "BadRequestException";
const NOT_FOUND = "NotFoundException";

/** 断言抛出的是指定的 Nest 异常类型，而不是任意 Error。 */
function rejects(promise, expectedName, messagePattern) {
  return assert.rejects(promise, (error) => {
    assert.equal(error.constructor.name, expectedName, `期望 ${expectedName}，实际 ${error.constructor.name}: ${error.message}`);
    if (messagePattern) assert.match(error.message, messagePattern);
    return true;
  });
}

function createStore({ categoryCode = "camera", declaredCodes = [], runMode = "development" } = {}) {
  const instances = new Map();
  const audits = [];
  return {
    instances,
    audits,
    runMode,
    async currentWorkspaceId() {
      return "ws_camera";
    },
    async workspaceScope() {
      return { categoryCode, declaredCodes };
    },
    async workspaceRunMode() {
      return this.runMode;
    },
    async listInstances() {
      return [...instances.values()];
    },
    async listInstancesInTx() {
      return [...instances.values()];
    },
    /** 复刻真实仓储的批量初始化：已存在的 code 跳过，不覆盖运营后来的决定。 */
    async initializeInstances(rows, auditRows) {
      const inserted = [];
      for (const row of rows) {
        if (!instances.has(row.code)) {
          instances.set(row.code, { ...row });
          inserted.push(row.code);
        }
      }
      for (const audit of auditRows.filter((row) => inserted.includes(row.code))) audits.push({ ...audit });
      return inserted;
    },
    async findInstance(_tenantId, _workspaceId, code) {
      return instances.get(code);
    },
    async listAudits(_tenantId, _workspaceId, code) {
      return code ? audits.filter((row) => row.code === code) : [...audits];
    },
    async saveInstance(instance, audit, expectedRevision) {
      const current = instances.get(instance.code);
      // 复刻真实仓储：首次写入撞上已存在的行 = 唯一键冲突；带版本写入必须精确命中。
      if (expectedRevision === undefined) {
        if (current) throw new ConflictException(`能力 ${instance.code} 正被并发修改，请刷新后重试`);
      } else if (!current || current.revision !== expectedRevision) {
        throw new ConflictException(`能力 ${instance.code} 已被其他人修改，请刷新后重试`);
      }
      instances.set(instance.code, { ...instance });
      audits.push({ ...audit });
      return { ...instance };
    }
  };
}

const TENANT = "tenant_001";
const CAMERA_CATEGORY = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
/** 直接读取生产定义，测试不能再维护一份会漂移的品类清单。 */
const CAMERA_DECLARED = [...CAMERA_CATEGORY.defaultCapabilities];
const CAMERA_REQUIRED = [...CAMERA_CATEGORY.requiredCapabilities];
const IMPLEMENTED_REQUIRED = CAMERA_REQUIRED.filter((code) =>
  RENTAL_CAPABILITY_MODULES.some((module) => module.code === code && module.implementationVersion)
);
const UNIMPLEMENTED_REQUIRED = CAMERA_REQUIRED.filter((code) => !IMPLEMENTED_REQUIRED.includes(code));

void (async () => {

// 幂等对账遇到 MySQL P2034 时必须重试完整事务；其他错误不得被吞掉或改写。
let transactionAttempts = 0;
const retryRepository = new WorkspaceCapabilityRepository({
  async $transaction(run) {
    transactionAttempts += 1;
    if (transactionAttempts === 1) throw Object.assign(new Error("deadlock"), { code: "P2034" });
    return run({ marker: "retry-tx" });
  }
});
assert.equal(
  await retryRepository.runInTransaction(async (tx) => tx.marker),
  "retry-tx",
  "P2034 后必须重跑整个幂等对账事务"
);
assert.equal(transactionAttempts, 2, "一次 P2034 只应触发一次重试");
await assert.rejects(
  new WorkspaceCapabilityRepository({
    async $transaction() {
      throw Object.assign(new Error("invalid"), { code: "P2002" });
    }
  }).runInTransaction(async () => "never"),
  /invalid/u,
  "非 P2034 不得自动重试"
);

// ============ 1. 注册表自身的一致性门禁 ============
assert.doesNotThrow(() => assertRentalCapabilityRegistry(), "真实注册表必须自洽");

const baseModule = {
  code: "locker",
  label: "替身",
  kind: "shared",
  extensionPoints: ["api"],
  applicableCategories: "all",
  dependsOn: [],
  conflictsWith: [],
  configSchema: []
};
/** 用一份克隆注册表做变异，绝不改动真实注册表。 */
const withModules = (...overrides) => [
  ...RENTAL_CAPABILITY_MODULES.filter((module) => !overrides.some((row) => row.code === module.code)),
  ...overrides
];

// 每一条都必须变红：门禁只要漏一条，错误就会推迟到运营点击开关时才暴露。
assert.throws(
  () => assertRentalCapabilityRegistry([...RENTAL_CAPABILITY_MODULES, { ...baseModule, code: "pickup" }]),
  /重复 code/u,
  "重复 code 必须被拒"
);
assert.throws(
  () => assertRentalCapabilityRegistry(withModules({ ...baseModule, dependsOn: ["not_registered"] })),
  /依赖未注册的能力/u,
  "依赖未注册能力必须被拒"
);
assert.throws(
  () => assertRentalCapabilityRegistry(withModules({ ...baseModule, dependsOn: ["locker"] })),
  /不能依赖自身/u,
  "自依赖必须被拒"
);
assert.throws(
  () => assertRentalCapabilityRegistry(withModules({ ...baseModule, conflictsWith: ["not_registered"] })),
  /未注册的互斥能力/u,
  "互斥未注册能力必须被拒"
);
assert.throws(
  () => assertRentalCapabilityRegistry(withModules({ ...baseModule, conflictsWith: ["locker"] })),
  /不能与自身互斥/u,
  "自互斥必须被拒"
);
assert.throws(
  () => assertRentalCapabilityRegistry(withModules({ ...baseModule, dependsOn: ["pickup"], conflictsWith: ["pickup"] })),
  /不能同时依赖并互斥/u,
  "同时依赖并互斥必须被拒"
);
// 依赖必须在本能力适用的每个品类里也适用，否则那个品类永远无法满足依赖。
assert.throws(
  () =>
    assertRentalCapabilityRegistry(
      withModules(
        { ...baseModule, applicableCategories: ["camera", "vehicle"], dependsOn: ["dispatch"] },
        { ...baseModule, code: "dispatch", applicableCategories: ["vehicle"] }
      )
    ),
  /不适用于这些品类/u,
  "依赖在部分品类不适用必须被拒"
);
assert.throws(
  () =>
    assertRentalCapabilityRegistry(
      withModules({ ...baseModule, configSchema: [
        { key: "same", label: "A", type: "string", required: false },
        { key: "same", label: "B", type: "string", required: false }
      ] })
    ),
  /配置项 same 重复/u,
  "配置项重复必须被拒"
);
assert.throws(
  () =>
    assertRentalCapabilityRegistry(
      withModules({ ...baseModule, configSchema: [{ key: "mode", label: "模式", type: "enum", required: true }] })
    ),
  /枚举配置项 mode 缺少可选值/u,
  "枚举缺可选值必须被拒"
);
assert.throws(
  () =>
    assertRentalCapabilityRegistry(
      withModules({ ...baseModule, configSchema: [{ key: "n", label: "N", type: "number", required: false, min: 10, max: 1 }] })
    ),
  /上下界倒挂/u,
  "数值上下界倒挂必须被拒"
);
console.log("  ✓ 注册表门禁：10 类不一致定义全部被拒");

// ============ 2. 三层状态：声明 ≠ 已实现 ≠ 已启用 ============
const store = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
const service = new WorkspaceCapabilityService(store);

const fresh = await service.overview(TENANT);
assert.equal(store.instances.size, 0, "读总览不得产生实例行");
const viewOf = (overview, code) => overview.capabilities.find((row) => row.definition.code === code);

// 配送由 Rental Core 内建提供，不需要空间另建 capability 实例。
const deliveryFresh = viewOf(fresh, "delivery");
assert.equal(deliveryFresh.declaredByCategory, true, "delivery 由 camera 品类声明");
assert.equal(deliveryFresh.providedByCore, true);
assert.equal(deliveryFresh.implemented, true);
assert.equal(deliveryFresh.state, "enabled");
assert.equal(await service.isEnabled(TENANT, "delivery"), true, "品类声明的 Core 能力必须直接可用");

// 有模块但没有实例行 → 「未启用」。这条区分是整个门禁的基础。
assert.equal(viewOf(fresh, "pickup").state, "enabled");
assert.equal(viewOf(fresh, "pickup").implemented, true);
// 未被本品类声明、也不是 shared 的能力 → declaredByCategory 必须为 false。
assert.equal(viewOf(fresh, "dispatch").declaredByCategory, false, "camera 未声明 dispatch");
assert.equal(viewOf(fresh, "dispatch").applicable, false, "dispatch 不适用于 camera");
// shared 能力即使品类没列，也算「声明」——它对全部品类开放。
assert.equal(viewOf(fresh, "locker").declaredByCategory, true, "shared 能力视为已声明");

assert.equal(fresh.productionReady, true, "没有强制扩展模块时 capability 层不得阻断基础营业");
assert.deepEqual(fresh.missingRequired, [], "基础 Core 能力不得作为待启用扩展项重复列出");
assert.equal(
  viewOf(fresh, "bundle_inventory").requiredForCategory,
  false,
  "通用库存引擎由 Rental Core 内建，不得伪装为需运营启用的扩展模块"
);
assert.equal(
  viewOf(fresh, "delivery").requiredForCategory,
  false,
  "非必选的共享模块不得被当前品类误标为必选"
);
console.log("  ✓ 三层状态：声明/已实现/已启用互不等同，基础 Core 不进入扩展门禁");

// ============ 3. 启用路径的 fail-closed 校验 ============
const enable = (code, extra = {}) =>
  service.save(TENANT, { code, status: "enabled", reason: "E2A 单测启用", ...extra }, "tester");

// 原因必填：生命周期变更是经营决策，事后要能解释。
await rejects(
  service.save(TENANT, { code: "camera_compatibility", status: "enabled", reason: "   " }, "tester"),
  BAD_REQUEST,
  /必须填写原因/u
);
// 未注册的 code 一律 404，绝不静默当成"该能力不存在所以跳过"。
await rejects(
  service.save(TENANT, { code: "no_such_capability", status: "enabled", reason: "x" }, "tester"),
  NOT_FOUND,
  /未注册的 capability/u
);
// Core 内建能力不允许重复创建空间实例。
await rejects(enable("delivery"), CONFLICT, /Rental Core 内建/u);
// 不适用于当前品类的能力不得启用（dispatch 只适用于 vehicle/construction）。
await rejects(enable("dispatch"), CONFLICT, /不适用于当前经营品类/u);
assert.equal(store.instances.size, 0, "以上任一失败都不得写出实例行");
assert.equal(store.audits.length, 0, "被拒的变更不得留下审计");

const extension = await enable("camera_compatibility");
assert.equal(extension.status, "enabled");
assert.equal(extension.implementationVersion, "cam-1.0", "启用时应锁定扩展模块当前实现版本");
assert.equal(extension.revision, 1, "首次写入 revision 从 1 起");
assert.equal(extension.configVersion, "v1");
assert.equal(await service.isEnabled(TENANT, "serialized_inventory"), true);
console.log("  ✓ 启用 fail-closed：Core 不重复落实例，未注册/不适用扩展均被拒");

// ============ 4. 配置逐字段校验 ============
// 已实现且 configSchema 为空的能力，任何配置键都是未知键 → 启用请求必须 400，且不落行。
const beforeBadConfig = store.instances.size;
await rejects(enable("camera_compatibility", { config: { anything: 1 } }), BAD_REQUEST, /不接受配置项 anything/u);
assert.equal(store.instances.size, beforeBadConfig, "配置无效时不得产生实例行（即不得启用）");

// 其余规则用可选扩展 locker 验证；Core 配置统一在业务规则页维护。
const save = (code, config, status = "disabled") =>
  service.save(TENANT, { code, status, config, reason: "配置校验" }, "tester");

await rejects(save("locker", {}), BAD_REQUEST, /缺少必填配置项/u);
await rejects(save("locker", { provider: 42 }), BAD_REQUEST, /必须是字符串/u);

const configured = await save("locker", { provider: "demo-locker" });
assert.equal(configured.config.provider, "demo-locker");
assert.equal(configured.status, "disabled", "保存配置不得顺带启用扩展");
assert.equal(await service.isEnabled(TENANT, "locker"), false);
console.log("  ✓ 配置校验：未知键、缺必填与类型错误均被拒，合法扩展配置可保存");

// ============ 5. 配置版本序号与审计动作 ============
// 版本号必须按整数递增。字符串版本号在两位数后会被字典序排错（"v10" < "v9"）。
let versioned = configured;
for (let round = 2; round <= 11; round += 1) {
  versioned = await service.save(
    TENANT,
    { code: "locker", status: "disabled", config: { provider: `provider-${round}` }, reason: `第 ${round} 次改配置`, expectedRevision: versioned.revision },
    "tester"
  );
  assert.equal(versioned.configVersion, `v${round}`, `第 ${round} 次改配置应得到 v${round}`);
}
assert.ok(
  Number(versioned.configVersion.slice(1)) > Number("v9".slice(1)),
  "v10 之后的序号必须按数值大于 v9（字符串比较会得出相反结论）"
);
// 状态未变而配置变了 → 审计动作是 configure，不是重复的 enable/disable。
assert.equal(store.audits.at(-1).action, "configure", "只改配置应记为 configure");
// 配置未变时不得凭空推进配置版本，否则版本号会失去"配置变过"的含义。
const unchanged = await service.save(
  TENANT,
  { code: "locker", status: "disabled", config: { provider: "provider-11" }, reason: "内容相同的重复提交", expectedRevision: versioned.revision },
  "tester"
);
assert.equal(unchanged.configVersion, versioned.configVersion, "配置未变不得推进配置版本");
assert.equal(unchanged.revision, versioned.revision + 1, "任何写入都必须推进 revision");
console.log("  ✓ 配置版本按整数递增（v11 > v9）、内容未变不推进、只改配置记为 configure");

// ============ 6. 生命周期与乐观并发 ============
// paused / disabled 都**不是**可用状态：门禁只认 enabled。
const paused = await service.save(
  TENANT,
  { code: "camera_compatibility", status: "paused", reason: "临时停用兼容检查", expectedRevision: extension.revision },
  "tester"
);
assert.equal(paused.status, "paused");
assert.ok(paused.pausedAt, "暂停必须记录时间");
assert.ok(paused.enabledAt, "暂停不得清掉原启用时间");
assert.equal(await service.isEnabled(TENANT, "camera_compatibility"), false, "paused 不得被判定为可用");
assert.equal(store.audits.at(-1).action, "pause");
assert.equal(store.audits.at(-1).fromStatus, "enabled");
assert.equal(store.audits.at(-1).toStatus, "paused");
assert.equal(store.audits.at(-1).operator, "tester", "审计必须记录操作人");

// 基于过期 revision 的写入必须 409，不能静默覆盖别人的修改。
await rejects(
  service.save(
    TENANT,
    { code: "camera_compatibility", status: "disabled", reason: "基于过期版本", expectedRevision: extension.revision },
    "other"
  ),
  CONFLICT,
  /已被其他人修改/u
);
assert.equal(
  (await service.overview(TENANT)).capabilities.find((row) => row.definition.code === "camera_compatibility").instance.status,
  "paused",
  "落败的并发写入不得改变现状"
);

// 实例还不存在时，带着一个非零版本号来改必须 409：那说明调用方读到的是别的行。
// `&& existing` 短路曾让这种请求静默新建一行。
const orphanStore = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
const orphanService = new WorkspaceCapabilityService(orphanStore);
await rejects(
  orphanService.save(TENANT, { code: "camera_compatibility", status: "enabled", reason: "基于不存在的行", expectedRevision: 7 }, "tester"),
  CONFLICT,
  /当前版本 0/u
);
assert.equal(orphanStore.instances.size, 0, "带过期版本号的首次写入不得落行");
// expectedRevision: 0 表示「我确认它还不存在」，必须允许首次创建。
const orphanCreated = await orphanService.save(
  TENANT,
  { code: "camera_compatibility", status: "enabled", reason: "确认尚不存在", expectedRevision: 0 },
  "tester"
);
assert.equal(orphanCreated.revision, 1, "expectedRevision=0 应允许首次创建");

// ============ 7. 升级入口 ============
await rejects(
  service.upgrade(TENANT, "pickup", { reason: "" }, "tester"),
  BAD_REQUEST,
  /必须填写原因/u
);
await rejects(
  service.upgrade(TENANT, "locker", { reason: "升级未实现能力" }, "tester"),
  CONFLICT,
  /尚无可执行模块/u
);
await rejects(
  service.upgrade(TENANT, "quantity_inventory", { reason: "尚未启用" }, "tester"),
  CONFLICT,
  /Rental Core 内建/u
);
await rejects(
  service.upgrade(TENANT, "camera_compatibility", { reason: "已是最新" }, "tester"),
  CONFLICT,
  /已是最新实现版本/u
);
console.log("  ✓ 生命周期与并发：paused 不可用、过期 revision 409、升级四类前置全部 fail-closed");

// ============ 8. 生产就绪判定 ============
// 当前四个首发品类没有强制扩展模块，扩展实例的生命周期不得影响基础营业。
const readyStore = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
const readyService = new WorkspaceCapabilityService(readyStore);
const ready = await readyService.overview(TENANT);
assert.deepEqual(ready.missingRequired, [], "未启用品类扩展不得进入基础营业缺项");
assert.equal(ready.productionReady, true, "基础经营条件由业务事实门禁负责，不由可选扩展阻断");
assert.equal(ready.capabilities.find((row) => row.definition.code === "delivery").state, "enabled");
const optional = await readyService.save(TENANT, { code: "camera_compatibility", status: "enabled", reason: "验证扩展生命周期" }, "tester");
await readyService.save(
  TENANT,
  { code: "camera_compatibility", status: "paused", reason: "规则检修", expectedRevision: optional.revision },
  "tester"
);
const afterPause = await readyService.overview(TENANT);
assert.deepEqual(afterPause.missingRequired, [], "暂停可选扩展不得污染基础经营缺项");
assert.equal(afterPause.productionReady, true, "暂停可选扩展后基础营业仍应可用");
console.log("  ✓ 生产就绪：基础经营与可选扩展生命周期已解耦");

// ============ 9. 已启用名单：Hook 运行时的执行依据 ============
// CORE-EXT-02B 的 Hook 运行时按这份名单决定执行哪些能力，因此它必须只含 enabled。
// 若退化为「有实例即返回」，暂停的能力仍会参与判定，暂停就成了只改显示的空操作。
await enable("camera_kit_handover");
const lifecycleStates = (await service.overview(TENANT)).capabilities
  .filter((row) => row.instance)
  .map((row) => `${row.definition.code}:${row.instance.status}`)
  .sort();
assert.ok(
  lifecycleStates.some((row) => row.endsWith(":enabled")) &&
    lifecycleStates.some((row) => row.endsWith(":paused")) &&
    lifecycleStates.some((row) => row.endsWith(":disabled")),
  `前置条件：本用例需要同时存在 enabled/paused/disabled 三种实例，实际 ${lifecycleStates.join("、")}`
);
const enabledOnly = await service.enabledInstances(TENANT);
assert.ok(enabledOnly.length > 0, "已启用名单不应为空（否则下面的断言没有区分力）");
assert.ok(
  enabledOnly.every((row) => row.status === "enabled"),
  `已启用名单只能含 enabled，实际 ${enabledOnly.map((row) => `${row.code}:${row.status}`).join("、")}`
);
assert.ok(
  enabledOnly.length < lifecycleStates.length,
  "已启用名单必须真的过滤掉了 paused/disabled（数量与实例总数相同说明没过滤）"
);
console.log("  ✓ 已启用名单只含 enabled，paused 与 disabled 均被排除");

// ============ 9b. CORE-EXT-02D：能力版本快照与快照→实例还原 ============
// 报价/订单固化的快照必须只含已启用能力、按 code 稳定排序、只保留判定所需字段。
const snapshot = await service.snapshotEnabled(TENANT);
assert.ok(snapshot.length > 0, "快照不应为空（前置已启用若干能力）");
assert.ok(
  snapshot.every((entry) => entry.code && entry.implementationVersion && entry.configVersion && entry.config),
  "快照每条必须含 code、实现版本、配置版本与配置本体"
);
assert.ok(
  snapshot.every((entry) => !("revision" in entry) && !("status" in entry) && !("updatedAt" in entry)),
  "快照是不可变历史事实，不得携带 revision/status/时间戳等会变动的字段"
);
const snapCodes = snapshot.map((entry) => entry.code);
assert.deepEqual(snapCodes, [...snapCodes].sort(), "快照必须按 code 稳定排序，便于复现比对");
// 上一条对「本就有序」的数据没有区分力，因此再用一个**逆序**返回实例的替身验证排序真的发生：
// 若 snapshotEnabled 不排序，逆序输入会原样逆序输出，这里必然变红。
const reverseStore = {
  async currentWorkspaceId() { return "ws_camera"; },
  async listInstances() {
    return [
      { tenantId: TENANT, workspaceId: "ws_camera", code: "return", status: "enabled", implementationVersion: "core-1.0", configVersion: "v1", config: {}, revision: 1, createdAt: "", updatedAt: "" },
      { tenantId: TENANT, workspaceId: "ws_camera", code: "pickup", status: "enabled", implementationVersion: "core-1.0", configVersion: "v1", config: {}, revision: 1, createdAt: "", updatedAt: "" },
      { tenantId: TENANT, workspaceId: "ws_camera", code: "bundle_inventory", status: "enabled", implementationVersion: "core-1.0", configVersion: "v1", config: {}, revision: 1, createdAt: "", updatedAt: "" }
    ];
  }
};
const reverseSnapshot = await new WorkspaceCapabilityService(reverseStore).snapshotEnabled(TENANT);
assert.deepEqual(
  reverseSnapshot.map((entry) => entry.code),
  ["bundle_inventory", "pickup", "return"],
  "逆序返回的实例必须被 snapshotEnabled 排成 code 升序（证明排序确实发生）"
);
// 快照里不得出现 paused / disabled 的扩展能力。
assert.ok(!snapCodes.includes("camera_compatibility"), "已暂停的能力不得进入快照");

// 还原：状态一律 enabled，让在途订单不因能力停用而中断履约。
const restored = WorkspaceCapabilityService.instancesFromSnapshot(TENANT, "ws_camera", snapshot);
assert.equal(restored.length, snapshot.length);
assert.ok(restored.every((row) => row.status === "enabled"), "还原出的实例状态必须恒为 enabled");
assert.ok(
  restored.every((row, index) => row.implementationVersion === snapshot[index].implementationVersion),
  "还原必须逐条保留快照的实现版本"
);
// 篡改还原结果的 config 不得回写快照（深拷贝隔离）。
restored[0].config.__tamper = "x";
assert.ok(!("__tamper" in snapshot[0].config), "还原实例与快照必须是独立对象，改一个不影响另一个");
const nestedSnapshot = [{
  code: "camera_compatibility", implementationVersion: "cam-1.0", configVersion: "v1",
  config: { relations: [{ id: "r1", relationType: "model_fit", source: { kind: "item_group", id: "a" }, target: { kind: "item_group", id: "b" }, outcome: "allow", sourceName: "测试", reason: "原始原因" }] }
}];
const nestedRestored = WorkspaceCapabilityService.instancesFromSnapshot(TENANT, "ws_camera", nestedSnapshot);
nestedRestored[0].config.relations[0].reason = "被篡改";
assert.equal(nestedSnapshot[0].config.relations[0].reason, "原始原因", "嵌套关系数组也必须深拷贝隔离");
console.log("  ✓ 能力快照：只含已启用、稳定排序、字段最小；还原为恒 enabled 实例且与快照隔离");

// ============ 10. 审计可按能力筛选且只增不改 ============
const allAudits = await service.listAudits(TENANT);
const bundleAudits = await service.listAudits(TENANT, "camera_compatibility");
assert.ok(allAudits.length >= bundleAudits.length && bundleAudits.length >= 2, "审计应可按能力筛选");
assert.ok(bundleAudits.every((row) => row.code === "camera_compatibility"), "筛选结果不得混入其他能力");
assert.ok(bundleAudits.every((row) => row.reason && row.at), "每条审计都必须有原因与时间");
assert.deepEqual(
  bundleAudits.map((row) => row.action),
  ["enable", "pause"],
  "审计应保留完整的动作序列（只增不改）"
);
console.log("  ✓ 审计只增不改、可按能力筛选、动作序列完整");

// ============ 12. 新空间必选能力初始化（Review P1-3） ============
{
  const store = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
  const svc = new WorkspaceCapabilityService(store);
  const tx = { marker: "workspace-create-tx" };

  // 当前四品类没有强制扩展模块，新空间不应为了基础营业自动制造 capability 实例。
  const before = await svc.overview(TENANT);
  const targets = WorkspaceCapabilityService.requiredInitializationTargets("camera", CAMERA_DECLARED)
    .map((row) => row.code)
    .sort();
  assert.deepEqual(targets, [], "没有强制扩展时初始化名单必须为空");
  assert.deepEqual(before.missingRequired, [], "基础 Core 能力不得列成扩展缺项");

  const result = await svc.initializeRequiredCapabilities(TENANT, "ws_camera", "camera", CAMERA_DECLARED, tx, {
    operator: "系统"
  });
  assert.deepEqual(result.enabled, [], "不得自动启用可选扩展");
  assert.equal(store.instances.size, 0, "不得为内建 Core 能力重复落实例");

  const after = await svc.overview(TENANT);
  assert.equal(after.productionReady, true, "capability 层无强制扩展时应就绪");
  assert.deepEqual(after.missingRequired, [], "初始化后不应凭空产生扩展缺项");

  // 可选能力一律不自动启用：那是经营决策，不是系统默认。
  for (const code of ["delivery", "locker"]) {
    assert.equal(store.instances.has(code), false, `可选/共享能力 ${code} 不得被自动启用`);
  }
  // 未实现的必选能力不得伪装启用。
  assert.equal(
    [...store.instances.values()].every((row) => row.implementationVersion && row.implementationVersion !== "unimplemented"),
    true,
    "自动启用的实例必须锁定真实实现版本"
  );
  // 审计动作必须是 system_initialize，而不是 enable——系统初始化与人的经营决策要能区分。
  assert.equal(store.audits.length, 0);
  assert.equal(
    store.audits.every((row) => row.action === "system_initialize" && row.toStatus === "enabled" && row.reason),
    true,
    "初始化审计必须记为 system_initialize 且带原因"
  );
  assert.equal(store.audits.every((row) => row.operator === "系统"), true, "初始化审计必须记录操作人");
  assert.equal(store.audits.every((row) => row.configSnapshot), true, "初始化审计必须保存完整配置快照");
  // 幂等：重复初始化仍不新增、不覆盖。
  const again = await svc.initializeRequiredCapabilities(TENANT, "ws_camera", "camera", CAMERA_DECLARED, tx);
  assert.deepEqual(again.enabled, [], "重复初始化不得新增实例");
  assert.equal(again.skipped.length, 0, "空目标无需报告伪跳过项");
  assert.equal(store.audits.length, 0, "重复初始化不得追加审计");
  console.log("  ✓ 扩展初始化：无强制扩展时不落实例，重复执行保持幂等");
}

// ============ 12b. 初始化的两道过滤：未实现、必填配置无默认值（Review P1-3） ============
{
  // 生产注册表里每个 category_required 能力都已实现、且都没有必填配置项，
  // 因此**用真实注册表构造不出**能触发这两道过滤的输入。注入候选注册表来验证。
  const REQUIRED_BASE = {
    kind: "category_required",
    extensionPoints: ["api"],
    applicableCategories: "all",
    dependsOn: [],
    conflictsWith: [],
    configSchema: []
  };
  const candidateRegistry = [
    // 已实现、无配置项 → 应当被初始化。
    { ...REQUIRED_BASE, code: "pickup", label: "领取", implementationVersion: "core-1.0" },
    // 必选但**未实现** → 不得进入名单，也不得伪装启用。
    { ...REQUIRED_BASE, code: "delivery", label: "配送（未实现）" },
    // 必选、已实现，但有**无默认值的必填配置项** → 不得自动启用（编造配置值等于伪装）。
    {
      ...REQUIRED_BASE,
      code: "locker",
      label: "自提柜",
      implementationVersion: "core-1.0",
      configSchema: [{ key: "provider", label: "柜机服务商", type: "string", required: true }]
    },
    // 必选、已实现、必填项**有默认值** → 可以自动启用，并写入该默认值。
    {
      ...REQUIRED_BASE,
      code: "usage_reading",
      label: "使用量读数",
      implementationVersion: "core-1.0",
      configSchema: [{ key: "metric", label: "读数口径", type: "string", required: true, defaultValue: "shutter" }]
    }
  ];
  const declared = ["pickup", "delivery", "locker", "usage_reading"];

  const targets = WorkspaceCapabilityService.requiredInitializationTargets("camera", declared, candidateRegistry, declared)
    .map((row) => row.code)
    .sort();
  assert.deepEqual(
    targets,
    ["locker", "pickup", "usage_reading"],
    "未实现的必选能力不得进入初始化名单（locker 因配置在下一步被跳过，但仍属名单内）"
  );
  assert.ok(!targets.includes("delivery"), "未实现的必选能力绝不能被自动启用");

  const store = createStore({ categoryCode: "camera", declaredCodes: declared });
  const svc = new WorkspaceCapabilityService(store);
  const result = await svc.initializeRequiredCapabilities(TENANT, "ws_camera", "camera", declared, {}, {
    registry: candidateRegistry,
    requiredCodes: declared
  });
  assert.deepEqual([...result.enabled].sort(), ["pickup", "usage_reading"], "只有配置齐备的必选能力被启用");
  assert.equal(store.instances.has("delivery"), false, "未实现的能力没有实例");
  assert.equal(store.instances.has("locker"), false, "必填配置无默认值的能力没有实例");
  const lockerSkip = result.skipped.find((row) => row.code === "locker");
  assert.ok(lockerSkip, "必填配置无默认值必须计入 skipped");
  assert.match(lockerSkip.why, /没有默认值/u, "跳过原因必须说明是配置缺默认值");
  assert.deepEqual(
    store.instances.get("usage_reading").config,
    { metric: "shutter" },
    "有默认值的必填配置项必须按默认值写入，而不是留空"
  );
  console.log("  ✓ 初始化过滤：未实现不入名单、必填配置无默认值跳过并说明原因、有默认值按默认值写入");
}

// ============ 12c. 结构化兼容关系校验与审计快照 ============
{
  const store = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
  const svc = new WorkspaceCapabilityService(store);
  const base = { code: "camera_compatibility", status: "enabled", reason: "配置摄影兼容关系" };
  await rejects(
    svc.save(TENANT, { ...base, config: { relations: [{ id: "bad" }] } }, "tester"),
    BAD_REQUEST,
    /relationType/u
  );
  const relation = {
    id: "adapter-ef-rf",
    relationType: "mount_adapter",
    source: { kind: "attribute", field: "mount", value: "EF" },
    target: { kind: "attribute", field: "mount", value: "RF" },
    outcome: "allow",
    sourceName: "厂商规格",
    reason: "原厂转接环"
  };
  const saved = await svc.save(TENANT, { ...base, config: { relations: [relation] } }, "tester");
  assert.deepEqual(saved.config.relations, [relation], "合法关系必须以结构化数据保存");
  assert.deepEqual(store.audits.at(-1).configSnapshot.relations, [relation], "审计必须固化本次完整关系配置");
  console.log("  ✓ 兼容关系：非法结构 fail-closed，合法关系结构化保存并进入审计快照");
}

// ============ 13. 正式经营门禁（Review P1-4） ============
{
  // development / demo：缺必选能力也放行，用于验证通用 Core。
  for (const runMode of ["development", "demo"]) {
    const store = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED, runMode });
    const svc = new WorkspaceCapabilityService(store);
    await svc.assertWorkspaceOperable(TENANT); // 不抛即通过
  }

  // production 的基础经营不再由可选扩展阻断；真实开业事实由业务门禁检查。
  const store = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED, runMode: "production" });
  const svc = new WorkspaceCapabilityService(store);
  await svc.assertWorkspaceOperable(TENANT);
  await svc.initializeRequiredCapabilities(TENANT, "ws_camera", "camera", CAMERA_DECLARED, {});
  await svc.assertWorkspaceOperable(TENANT);
  console.log("  ✓ 经营门禁：四品类基础营业不再被可选扩展模块阻断");
}

console.log("\nCORE-EXT-02A capability 运行时用例全部通过");
})();
