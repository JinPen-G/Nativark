const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { WorkspaceCapabilityService } = require("../apps/api/src/modules/rental-core/workspace-capability.service");
const { assertRentalCapabilityRegistry } = require("../apps/api/src/modules/rental-core/rental-extension-registry");
const { RENTAL_CAPABILITY_MODULES } = require("@store-rental/shared");
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

function createStore({ categoryCode = "camera", declaredCodes = [] } = {}) {
  const instances = new Map();
  const audits = [];
  return {
    instances,
    audits,
    async currentWorkspaceId() {
      return "ws_camera";
    },
    async workspaceScope() {
      return { categoryCode, declaredCodes };
    },
    async listInstances() {
      return [...instances.values()];
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
/** camera 品类实际声明的 code，与 RENTAL_CATEGORIES 保持一致。 */
const CAMERA_DECLARED = [
  "serialized_inventory",
  "quantity_inventory",
  "bundle_inventory",
  "pickup",
  "return",
  "delivery",
  "usage_reading"
];
const IMPLEMENTED_REQUIRED = ["serialized_inventory", "quantity_inventory", "pickup", "return"];

void (async () => {

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

// 品类声明了 delivery，但它没有可执行模块 → 只能是「已声明但未实现」，不是可用功能。
const deliveryFresh = viewOf(fresh, "delivery");
assert.equal(deliveryFresh.declaredByCategory, true, "delivery 由 camera 品类声明");
assert.equal(deliveryFresh.implemented, false, "delivery 尚无 implementationVersion");
assert.equal(deliveryFresh.state, "declared_not_implemented");
assert.equal(await service.isEnabled(TENANT, "delivery"), false, "未启用的能力 isEnabled 必须为 false");

// 有模块但没有实例行 → 「未启用」。这条区分是整个门禁的基础。
assert.equal(viewOf(fresh, "pickup").state, "not_enabled");
assert.equal(viewOf(fresh, "pickup").implemented, true);
// 未被本品类声明、也不是 shared 的能力 → declaredByCategory 必须为 false。
assert.equal(viewOf(fresh, "dispatch").declaredByCategory, false, "camera 未声明 dispatch");
assert.equal(viewOf(fresh, "dispatch").applicable, false, "dispatch 不适用于 camera");
// shared 能力即使品类没列，也算「声明」——它对全部品类开放。
assert.equal(viewOf(fresh, "locker").declaredByCategory, true, "shared 能力视为已声明");

assert.equal(fresh.productionReady, false, "一个能力都没启用时不得判定为生产就绪");
assert.deepEqual(
  [...fresh.missingRequired].sort(),
  [...IMPLEMENTED_REQUIRED].sort(),
  "缺失必选能力应恰为 camera 声明的四个必选能力"
);
console.log("  ✓ 三层状态：声明/已实现/已启用互不等同，缺失必选能力可枚举");

// ============ 3. 启用路径的 fail-closed 校验 ============
const enable = (code, extra = {}) =>
  service.save(TENANT, { code, status: "enabled", reason: "E2A 单测启用", ...extra }, "tester");

// 原因必填：生命周期变更是经营决策，事后要能解释。
await rejects(
  service.save(TENANT, { code: "pickup", status: "enabled", reason: "   " }, "tester"),
  BAD_REQUEST,
  /必须填写原因/u
);
// 未注册的 code 一律 404，绝不静默当成"该能力不存在所以跳过"。
await rejects(
  service.save(TENANT, { code: "no_such_capability", status: "enabled", reason: "x" }, "tester"),
  NOT_FOUND,
  /未注册的 capability/u
);
// 只有 code、没有可执行模块的能力不得启用——否则菜单与 API 会对着不存在的模块放行。
await rejects(enable("delivery"), CONFLICT, /已声明但尚无可执行模块/u);
// 不适用于当前品类的能力不得启用（dispatch 只适用于 vehicle/construction）。
await rejects(enable("dispatch"), CONFLICT, /不适用于当前经营品类/u);
// 依赖未启用时不得启用：bundle_inventory 依赖 serialized_inventory。
await rejects(enable("bundle_inventory"), CONFLICT, /依赖 serialized_inventory/u);
assert.equal(store.instances.size, 0, "以上任一失败都不得写出实例行");
assert.equal(store.audits.length, 0, "被拒的变更不得留下审计");

// 依赖满足后同一次调用必须成功——证明上面的拒绝来自依赖判定，而不是别的原因。
const serialized = await enable("serialized_inventory");
assert.equal(serialized.status, "enabled");
assert.equal(serialized.implementationVersion, "core-1.0", "启用时应锁定注册表当前实现版本");
assert.equal(serialized.revision, 1, "首次写入 revision 从 1 起");
assert.equal(serialized.configVersion, "v1");
const bundle = await enable("bundle_inventory");
assert.equal(bundle.status, "enabled", "依赖已启用后 bundle_inventory 必须可启用");
assert.equal(await service.isEnabled(TENANT, "serialized_inventory"), true);
console.log("  ✓ 启用 fail-closed：缺原因/未注册/未实现/不适用/缺依赖全部被拒且不落行");

// ============ 4. 配置逐字段校验 ============
// 已实现且 configSchema 为空的能力，任何配置键都是未知键 → 启用请求必须 400，且不落行。
const beforeBadConfig = store.instances.size;
await rejects(enable("pickup", { config: { anything: 1 } }), BAD_REQUEST, /不接受配置项 anything/u);
assert.equal(store.instances.size, beforeBadConfig, "配置无效时不得产生实例行（即不得启用）");

// 其余规则用 delivery/locker/usage_reading 验证：它们有真实 configSchema。
// 用非 enabled 状态是为了绕过"未实现不得启用"，从而抵达配置校验分支本身。
const save = (code, config, status = "disabled") =>
  service.save(TENANT, { code, status, config, reason: "配置校验" }, "tester");

await rejects(save("delivery", {}), BAD_REQUEST, /缺少必填配置项/u);
await rejects(save("delivery", { maxDistanceKm: "远" }), BAD_REQUEST, /必须是数值/u);
await rejects(save("delivery", { maxDistanceKm: -1 }), BAD_REQUEST, /不能小于 0/u);
await rejects(save("delivery", { maxDistanceKm: 501 }), BAD_REQUEST, /不能大于 500/u);
await rejects(
  save("delivery", { maxDistanceKm: 10, requireSignature: "yes" }),
  BAD_REQUEST,
  /必须是布尔值/u
);
await rejects(save("locker", { provider: 42 }), BAD_REQUEST, /必须是字符串/u);
await rejects(save("usage_reading", { metric: "temperature" }), BAD_REQUEST, /只能是/u);

// 合法配置必须通过，且数值被规范化为 number（"12" → 12），否则下游要各自再转一次。
const delivered = await save("delivery", { maxDistanceKm: "12", requireSignature: true });
assert.equal(delivered.config.maxDistanceKm, 12, "数值配置应规范化为 number");
assert.equal(delivered.config.requireSignature, true);
assert.equal(delivered.status, "disabled", "配置合法也不得把未实现的能力顺带启用");
assert.equal(await service.isEnabled(TENANT, "delivery"), false);
console.log("  ✓ 配置校验：未知键/缺必填/类型/上下界/枚举越界全部被拒，合法值被规范化");

// ============ 5. 配置版本序号与审计动作 ============
// 版本号必须按整数递增。字符串版本号在两位数后会被字典序排错（"v10" < "v9"）。
let versioned = delivered;
for (let round = 2; round <= 11; round += 1) {
  versioned = await service.save(
    TENANT,
    { code: "delivery", status: "disabled", config: { maxDistanceKm: round }, reason: `第 ${round} 次改配置`, expectedRevision: versioned.revision },
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
  { code: "delivery", status: "disabled", config: { maxDistanceKm: 11 }, reason: "内容相同的重复提交", expectedRevision: versioned.revision },
  "tester"
);
assert.equal(unchanged.configVersion, versioned.configVersion, "配置未变不得推进配置版本");
assert.equal(unchanged.revision, versioned.revision + 1, "任何写入都必须推进 revision");
console.log("  ✓ 配置版本按整数递增（v11 > v9）、内容未变不推进、只改配置记为 configure");

// ============ 6. 生命周期与乐观并发 ============
// paused / disabled 都**不是**可用状态：门禁只认 enabled。
const paused = await service.save(
  TENANT,
  { code: "bundle_inventory", status: "paused", reason: "临时停用套装", expectedRevision: bundle.revision },
  "tester"
);
assert.equal(paused.status, "paused");
assert.ok(paused.pausedAt, "暂停必须记录时间");
assert.ok(paused.enabledAt, "暂停不得清掉原启用时间");
assert.equal(await service.isEnabled(TENANT, "bundle_inventory"), false, "paused 不得被判定为可用");
assert.equal(store.audits.at(-1).action, "pause");
assert.equal(store.audits.at(-1).fromStatus, "enabled");
assert.equal(store.audits.at(-1).toStatus, "paused");
assert.equal(store.audits.at(-1).operator, "tester", "审计必须记录操作人");

// 基于过期 revision 的写入必须 409，不能静默覆盖别人的修改。
await rejects(
  service.save(
    TENANT,
    { code: "bundle_inventory", status: "disabled", reason: "基于过期版本", expectedRevision: bundle.revision },
    "other"
  ),
  CONFLICT,
  /已被其他人修改/u
);
assert.equal(
  (await service.overview(TENANT)).capabilities.find((row) => row.definition.code === "bundle_inventory").instance.status,
  "paused",
  "落败的并发写入不得改变现状"
);

// 实例还不存在时，带着一个非零版本号来改必须 409：那说明调用方读到的是别的行。
// `&& existing` 短路曾让这种请求静默新建一行。
const orphanStore = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
const orphanService = new WorkspaceCapabilityService(orphanStore);
await rejects(
  orphanService.save(TENANT, { code: "pickup", status: "enabled", reason: "基于不存在的行", expectedRevision: 7 }, "tester"),
  CONFLICT,
  /当前版本 0/u
);
assert.equal(orphanStore.instances.size, 0, "带过期版本号的首次写入不得落行");
// expectedRevision: 0 表示「我确认它还不存在」，必须允许首次创建。
const orphanCreated = await orphanService.save(
  TENANT,
  { code: "pickup", status: "enabled", reason: "确认尚不存在", expectedRevision: 0 },
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
  NOT_FOUND,
  /尚未在本经营空间启用/u
);
await rejects(
  service.upgrade(TENANT, "serialized_inventory", { reason: "已是最新" }, "tester"),
  CONFLICT,
  /已是最新实现版本/u
);
console.log("  ✓ 生命周期与并发：paused 不可用、过期 revision 409、升级四类前置全部 fail-closed");

// ============ 8. 生产就绪判定 ============
// 必选能力全部 enabled 才算就绪。先把四个必选能力都启用。
const readyStore = createStore({ categoryCode: "camera", declaredCodes: CAMERA_DECLARED });
const readyService = new WorkspaceCapabilityService(readyStore);
for (const code of IMPLEMENTED_REQUIRED) {
  await readyService.save(TENANT, { code, status: "enabled", reason: "上线准备" }, "tester");
}
const ready = await readyService.overview(TENANT);
assert.deepEqual(ready.missingRequired, [], "四个必选能力已启用后不应再有缺失项");
assert.equal(ready.productionReady, true, "必选能力齐备应判定为生产就绪");
// 未实现的 delivery 仍是「已声明但未实现」，且不影响就绪判定（它不是 category_required）。
assert.equal(ready.capabilities.find((row) => row.definition.code === "delivery").state, "declared_not_implemented");
// 任一必选能力被暂停，就绪状态必须立刻回落——否则暂停就成了只改显示的空操作。
const toPause = ready.capabilities.find((row) => row.definition.code === "pickup").instance;
await readyService.save(
  TENANT,
  { code: "pickup", status: "paused", reason: "设备检修", expectedRevision: toPause.revision },
  "tester"
);
const afterPause = await readyService.overview(TENANT);
assert.deepEqual(afterPause.missingRequired, ["pickup"], "暂停的必选能力必须重新计入缺失");
assert.equal(afterPause.productionReady, false, "必选能力被暂停后不得仍判定为生产就绪");
console.log("  ✓ 生产就绪：必选齐备为 true，任一必选被暂停立刻回落为 false");

// ============ 9. 已启用名单：Hook 运行时的执行依据 ============
// CORE-EXT-02B 的 Hook 运行时按这份名单决定执行哪些能力，因此它必须只含 enabled。
// 若退化为「有实例即返回」，暂停的能力仍会参与判定，暂停就成了只改显示的空操作。
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
// 快照里不得出现 paused / disabled 的能力（bundle_inventory 在上面已被暂停）。
assert.ok(!snapCodes.includes("bundle_inventory"), "已暂停的能力不得进入快照");

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
console.log("  ✓ 能力快照：只含已启用、稳定排序、字段最小；还原为恒 enabled 实例且与快照隔离");

// ============ 10. 审计可按能力筛选且只增不改 ============
const allAudits = await service.listAudits(TENANT);
const bundleAudits = await service.listAudits(TENANT, "bundle_inventory");
assert.ok(allAudits.length >= bundleAudits.length && bundleAudits.length >= 2, "审计应可按能力筛选");
assert.ok(bundleAudits.every((row) => row.code === "bundle_inventory"), "筛选结果不得混入其他能力");
assert.ok(bundleAudits.every((row) => row.reason && row.at), "每条审计都必须有原因与时间");
assert.deepEqual(
  bundleAudits.map((row) => row.action),
  ["enable", "pause"],
  "审计应保留完整的动作序列（只增不改）"
);
console.log("  ✓ 审计只增不改、可按能力筛选、动作序列完整");

console.log("\nCORE-EXT-02A capability 运行时用例全部通过");
})();
