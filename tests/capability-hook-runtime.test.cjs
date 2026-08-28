const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { CapabilityHookRuntime } = require("../apps/api/src/modules/rental-core/capability-hook.runtime");
const { RENTAL_CAPABILITY_HOOK_POINTS } = require("@store-rental/shared");

/**
 * CORE-EXT-02B：Hook 运行时的判定口径。
 *
 * 不连库：验证「未启用不执行、确定性顺序、必选 fail-closed、能力只能返回意见」。
 * 落库语义（审计、关联任务随事务回滚）在 mysql-e2e 里验证。
 */

const TENANT = "tenant_001";
const WORKSPACE = "ws_camera";

function instance(code, status = "enabled", extra = {}) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    code,
    status,
    implementationVersion: "core-1.0",
    configVersion: "v1",
    config: {},
    revision: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...extra
  };
}

/** 只实现运行时用到的那一个方法，替身比真实服务宽松就会让断言失去意义。 */
function fakeCapabilities(instances) {
  return {
    async enabledInstances() {
      return instances.filter((row) => row.status === "enabled");
    }
  };
}

const baseRun = (extra = {}) => ({
  point: "quote_validation",
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  categoryCode: "camera",
  subject: { id: "quote_1", amount: 100 },
  ...extra
});

void (async () => {

// ============ 1. 登记表本身的门禁 ============
{
  const runtime = new CapabilityHookRuntime(fakeCapabilities([]));
  assert.throws(
    () => runtime.register({ code: "not_a_capability", order: 10, hooks: { quote_validation: () => ({ decision: "allow" }) } }),
    /未注册的能力/u,
    "拼错的 code 必须直接失败，否则会被静默登记成永不执行的 Hook"
  );
  assert.throws(
    () => runtime.register({ code: "delivery", order: 10, hooks: {} }),
    /没有任何触发点/u,
    "登记了 Hook 却没有触发点属配置错误"
  );
  runtime.register({ code: "delivery", order: 10, hooks: { quote_validation: () => ({ decision: "allow" }) } });
  assert.throws(
    () => runtime.register({ code: "delivery", order: 20, hooks: { quote_validation: () => ({ decision: "allow" }) } }),
    /不能重复登记/u,
    "重复登记会让两份实现互相覆盖"
  );
  assert.deepEqual(runtime.registeredCodes(), ["delivery"]);
  console.log("  ✓ 登记门禁：未注册 code、无触发点、重复登记全部被拒");
}

// ============ 2. 未启用的能力不执行 ============
{
  const calls = [];
  const record = (code) => () => {
    calls.push(code);
    return { decision: "allow" };
  };
  const runtime = new CapabilityHookRuntime(
    fakeCapabilities([
      instance("delivery", "enabled"),
      instance("locker", "paused"),
      instance("usage_reading", "disabled")
      // qualification 连实例行都没有 = 从未启用
    ])
  );
  runtime.register({ code: "delivery", order: 10, hooks: { quote_validation: record("delivery") } });
  runtime.register({ code: "locker", order: 20, hooks: { quote_validation: record("locker") } });
  runtime.register({ code: "usage_reading", order: 30, hooks: { quote_validation: record("usage_reading") } });
  runtime.register({ code: "qualification", order: 40, hooks: { quote_validation: record("qualification") } });

  const outcome = await runtime.run(baseRun());
  assert.deepEqual(calls, ["delivery"], "只有 enabled 的能力可以执行；paused/disabled/无实例一律不执行");
  assert.deepEqual(
    outcome.executed.map((row) => row.capability),
    ["delivery"],
    "executed 只应包含真正执行过的能力"
  );
  assert.equal(outcome.blocked, false);
  console.log("  ✓ 未启用不执行：paused、disabled 与无实例的能力都不参与判定");
}

// ============ 3. 只执行被请求节点的 Hook ============
{
  const calls = [];
  const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]));
  runtime.register({
    code: "delivery",
    order: 10,
    hooks: {
      quote_validation: () => {
        calls.push("quote_validation");
        return { decision: "allow" };
      },
      settlement: () => {
        calls.push("settlement");
        return { decision: "allow" };
      }
    }
  });
  await runtime.run(baseRun({ point: "settlement" }));
  assert.deepEqual(calls, ["settlement"], "只能执行被请求节点的 Hook");
  // 没有登记该节点的能力不产生 executed 记录，也不算失败。
  const untouched = await runtime.run(baseRun({ point: "item_onboarding" }));
  assert.deepEqual(untouched.executed, [], "未登记该节点的能力不应出现在 executed 里");
  assert.equal(untouched.blocked, false, "没有能力关心的节点必须放行");
  console.log("  ✓ 节点隔离：只执行被请求节点，未登记该节点不算失败");
}

// ============ 4. 确定性执行顺序 ============
{
  const build = (instancesInAnyOrder) => {
    const calls = [];
    const runtime = new CapabilityHookRuntime(fakeCapabilities(instancesInAnyOrder));
    // order 相同的两个能力（locker/qualification）必须按 code 升序，
    // 不能依赖注册顺序或实例数组顺序。
    runtime.register({ code: "usage_reading", order: 5, hooks: { quote_validation: () => (calls.push("usage_reading"), { decision: "allow" }) } });
    runtime.register({ code: "locker", order: 10, hooks: { quote_validation: () => (calls.push("locker"), { decision: "allow" }) } });
    runtime.register({ code: "qualification", order: 10, hooks: { quote_validation: () => (calls.push("qualification"), { decision: "allow" }) } });
    runtime.register({ code: "delivery", order: 1, hooks: { quote_validation: () => (calls.push("delivery"), { decision: "allow" }) } });
    return { runtime, calls };
  };

  const forward = build([instance("delivery"), instance("locker"), instance("qualification"), instance("usage_reading")]);
  await forward.runtime.run(baseRun());
  assert.deepEqual(
    forward.calls,
    ["delivery", "usage_reading", "locker", "qualification"],
    "执行序必须是 (order, code) 升序"
  );

  // 把实例数组反过来，结论必须完全一致——否则顺序取决于查库返回序。
  const reversed = build([instance("usage_reading"), instance("qualification"), instance("locker"), instance("delivery")]);
  await reversed.runtime.run(baseRun());
  assert.deepEqual(reversed.calls, forward.calls, "实例数组顺序不得影响执行序");
  console.log("  ✓ 确定性顺序：按 (order, code) 升序，与登记序和实例数组序无关");
}

// ============ 5. 能力不能改写业务对象 ============
{
  const live = { id: "order_1", status: "reserved", lines: [{ id: "line_1", quantity: 2 }] };
  const observed = {};
  let strictModeError;
  const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]));
  runtime.register({
    code: "delivery",
    order: 10,
    hooks: {
      order_confirmation: (context) => {
        // 结构性保证：快照必须逐层冻结。只冻结顶层不够——嵌套数组元素照样能被改写。
        observed.top = Object.isFrozen(context.subject);
        observed.array = Object.isFrozen(context.subject.lines);
        observed.element = Object.isFrozen(context.subject.lines[0]);
        observed.notSameRef = context.subject.lines[0] !== live.lines[0];
        // 真实能力模块由 TypeScript 编译，必然是严格模式，此时写入会**抛错**。
        // 本测试文件是 sloppy 模式的 .cjs，写入只会静默失败，故显式进严格模式验证。
        try {
          (function () {
            "use strict";
            context.subject.status = "completed";
          })();
        } catch (error) {
          strictModeError = error;
        }
        // sloppy 模式下的写入不抛错，但同样必须无效。
        context.subject.lines[0].quantity = 999;
        return { decision: "allow" };
      }
    }
  });
  await runtime.run(baseRun({ point: "order_confirmation", subject: live }));
  assert.equal(observed.top, true, "快照顶层必须冻结");
  assert.equal(observed.array, true, "快照里的数组必须冻结");
  assert.equal(observed.element, true, "快照里的数组元素必须冻结（浅冻结不够）");
  assert.equal(observed.notSameRef, true, "必须是克隆而不是活对象——冻结活对象会让 Core 随后的写入抛错");
  assert.ok(strictModeError, "严格模式下改写快照必须抛错（真实能力模块都是严格模式）");
  assert.equal(live.status, "reserved", "活对象状态不得被能力改写");
  assert.equal(live.lines[0].quantity, 2, "嵌套元素同样不得被改写");
  console.log("  ✓ 只读快照：逐层冻结且为克隆，严格模式写入抛错，活对象未被污染");
}

// ============ 6. 必选能力 fail-closed，可选能力降级放行 ============
{
  // serialized_inventory 是 category_required；delivery 是 shared（非必选）。
  const runtime = new CapabilityHookRuntime(
    fakeCapabilities([instance("serialized_inventory"), instance("delivery")])
  );
  runtime.register({
    code: "serialized_inventory",
    order: 10,
    hooks: {
      order_confirmation: () => {
        throw new Error("库存服务不可用");
      }
    }
  });
  runtime.register({
    code: "delivery",
    order: 20,
    hooks: {
      order_confirmation: () => {
        throw new Error("配送服务不可用");
      }
    }
  });
  const outcome = await runtime.run(baseRun({ point: "order_confirmation" }));
  assert.equal(outcome.blocked, true, "必选能力故障必须 fail-closed 阻止");
  assert.equal(outcome.blockReasons.length, 1, "只有必选能力的故障进入阻止原因");
  assert.equal(outcome.blockReasons[0].capability, "serialized_inventory");
  assert.match(outcome.blockReasons[0].message, /库存服务不可用/u, "阻止原因必须保留底层故障信息");
  // 可选能力故障不得静默跳过：任务明确禁止把基础设施异常吞成「能力不存在」。
  assert.equal(outcome.notices.length, 1, "可选能力故障必须留一条可审计提示");
  assert.equal(outcome.notices[0].capability, "delivery");
  assert.equal(outcome.notices[0].code, "capability_hook_failed");
  const failed = outcome.executed.filter((row) => row.failed);
  assert.equal(failed.length, 2, "两个故障都必须出现在 executed 里并标记 failed");
  assert.deepEqual(
    failed.map((row) => row.decision).sort(),
    ["block", "warn"],
    "必选故障记为 block，可选故障记为 warn"
  );
  console.log("  ✓ 故障处理：必选能力故障 fail-closed 阻止，可选能力故障降级但留痕");
}

// ============ 7. 结果契约的运行期校验 ============
{
  const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]));
  let payload = { decision: "block" };
  runtime.register({ code: "delivery", order: 10, hooks: { quote_validation: () => payload } });

  await assert.rejects(
    runtime.run(baseRun()),
    /阻止了本次操作但没有给出原因/u,
    "block 不给原因必须失败：审计里不能出现无法解释的拒绝"
  );
  payload = { decision: "sometimes" };
  await assert.rejects(runtime.run(baseRun()), /未知判定/u, "未知判定值必须失败");
  payload = { decision: "allow", feeBases: [{ code: "f", label: "费", amount: 10, currency: "CNY", basis: "  " }] };
  await assert.rejects(runtime.run(baseRun()), /缺少计算说明/u, "费用依据必须有计算说明");
  payload = { decision: "allow", feeBases: [{ code: "f", label: "费", amount: Number.NaN, currency: "CNY", basis: "按天" }] };
  await assert.rejects(runtime.run(baseRun()), /不是有效数值/u, "费用金额必须是有效数值");
  console.log("  ✓ 结果契约：无原因的 block、未知判定、无依据或非法金额的费用全部被拒");
}

// ============ 8. 合并结论：四类产物都带来源能力，判定时刻统一 ============
{
  const seenAt = [];
  const runtime = new CapabilityHookRuntime(
    fakeCapabilities([
      instance("delivery", "enabled", { configVersion: "v3", config: { maxDistanceKm: 30 } }),
      instance("locker", "enabled", { implementationVersion: "shared-2.0" })
    ])
  );
  runtime.register({
    code: "delivery",
    order: 10,
    hooks: {
      settlement: (context) => {
        seenAt.push(context.at);
        // 能力只能按自己的配置判定；配置必须是冻结的只读视图。
        assert.equal(context.capability.configVersion, "v3");
        assert.equal(context.capability.config.maxDistanceKm, 30);
        assert.equal(Object.isFrozen(context.capability.config), true, "配置必须是冻结的只读视图");
        return {
          decision: "warn",
          notices: [{ code: "far", message: "超出常规配送半径", evidence: { km: 42 } }],
          feeBases: [{ code: "long_haul", label: "远程配送费", amount: 88, currency: "CNY", basis: "超出 30km 部分按 12km 计" }],
          linkedTasks: [{ code: "arrange_courier", title: "安排远程配送" }]
        };
      }
    }
  });
  runtime.register({
    code: "locker",
    order: 20,
    hooks: {
      settlement: (context) => {
        seenAt.push(context.at);
        assert.equal(context.capability.implementationVersion, "shared-2.0");
        return { decision: "allow", notices: [{ code: "locker_ok", message: "柜格已预留" }] };
      }
    }
  });

  const outcome = await runtime.run(baseRun({ point: "settlement", operator: "张三" }));
  assert.equal(outcome.blocked, false, "warn 不得阻止");
  assert.equal(outcome.notices.length, 2);
  assert.deepEqual(outcome.notices.map((row) => row.capability), ["delivery", "locker"]);
  assert.equal(outcome.feeBases.length, 1);
  assert.equal(outcome.feeBases[0].capability, "delivery", "费用依据必须带来源能力，否则账说不清是谁加的");
  assert.equal(outcome.feeBases[0].amount, 88);
  assert.equal(outcome.linkedTasks[0].capability, "delivery");
  assert.deepEqual(
    outcome.executed,
    [
      { capability: "delivery", implementationVersion: "core-1.0", configVersion: "v3", decision: "warn" },
      { capability: "locker", implementationVersion: "shared-2.0", configVersion: "v1", decision: "allow" }
    ],
    "executed 必须记录每个能力的版本与判定，供审计与快照引用"
  );
  // 同一次判定内所有能力必须看到同一个时刻，否则同一动作的证据时间彼此不一致。
  assert.equal(new Set(seenAt).size, 1, "一次 run 内 at 必须唯一");
  console.log("  ✓ 合并结论：提示/费用依据/关联任务均带来源能力，版本入 executed，判定时刻统一");
}

// ============ 9. 触发点枚举与运行时保持一致 ============
{
  assert.deepEqual(
    [...RENTAL_CAPABILITY_HOOK_POINTS],
    ["item_onboarding", "quote_validation", "order_confirmation", "allocation_dispatch", "pickup_delivery", "return_inspection", "settlement"],
    "七个触发点必须与任务定义一致（商品建档/报价校验/订单确认/配货调度/领取交付/归还检查/结算）"
  );
  console.log("  ✓ 触发点枚举覆盖任务定义的七个节点");
}

// ============ 10. evaluate：阻止即抛、放行即在调用方事务里落审计 ============
{
  const written = [];
  const fakeAudits = {
    async recordOutcome(tenantId, workspaceId, subjectRef, outcome, tx, operator, at) {
      written.push({ tenantId, workspaceId, subjectRef, point: outcome.point, tx, operator, at, rows: outcome.executed.length });
      return outcome.executed.length;
    }
  };
  const tx = { marker: "caller-tx" };
  const evaluateInput = (extra = {}) => ({
    ...baseRun({ point: "order_confirmation", operator: "李四" }),
    subjectRef: { type: "order", id: "order_9" },
    tx,
    ...extra
  });

  // 放行：审计必须用**调用方的事务**写入，否则事务回滚时审计留了下来。
  {
    let seenAtInEvaluate;
    const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]), fakeAudits);
    runtime.register({
      code: "delivery",
      order: 10,
      hooks: {
        order_confirmation: (context) => {
          seenAtInEvaluate = context.at;
          return { decision: "warn", notices: [{ code: "n", message: "提示" }] };
        }
      }
    });
    const outcome = await runtime.evaluate(evaluateInput());
    assert.equal(outcome.blocked, false);
    assert.equal(written.length, 1, "放行的判定必须落审计（否则「可选提示可审计」不成立）");
    assert.equal(written[0].tx, tx, "审计必须使用调用方传入的事务客户端");
    assert.equal(written[0].subjectRef.id, "order_9", "审计必须能按判定对象追溯");
    assert.equal(written[0].operator, "李四", "审计必须记录操作人");
    assert.equal(written[0].at, seenAtInEvaluate, "审计时刻必须与能力看到的判定时刻一致，不能各取一次当前时间");
  }

  // 阻止：必须抛 409，且**不落审计**（它所在的事务必然回滚）。
  {
    written.length = 0;
    const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]), fakeAudits);
    runtime.register({
      code: "delivery",
      order: 10,
      hooks: {
        order_confirmation: () => ({ decision: "block", blockReasons: [{ code: "no_slot", message: "无可用配送时段" }] })
      }
    });
    await assert.rejects(
      runtime.evaluate(evaluateInput()),
      (error) => {
        assert.equal(error.constructor.name, "CapabilityBlockedException");
        assert.match(error.message, /delivery - 无可用配送时段/u, "异常必须说明是谁、基于什么依据阻止的");
        assert.equal(error.outcome.blocked, true, "异常必须带完整结论供调用方解释");
        return true;
      }
    );
    assert.equal(written.length, 0, "被阻止的判定不得落审计：它所在的事务必然回滚");
  }

  // 没有任何能力执行时不写审计，也不报错。
  {
    written.length = 0;
    const runtime = new CapabilityHookRuntime(fakeCapabilities([]), fakeAudits);
    const outcome = await runtime.evaluate(evaluateInput());
    assert.equal(outcome.executed.length, 0);
    assert.equal(written.length, 0, "没有能力参与判定时不应产生审计行");
  }

  // 装配缺仓储时必须明确失败，不能静默跳过审计。
  {
    const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]));
    runtime.register({ code: "delivery", order: 10, hooks: { order_confirmation: () => ({ decision: "allow" }) } });
    await assert.rejects(
      runtime.evaluate(evaluateInput()),
      /未注入，无法落 Hook 审计/u,
      "缺仓储时静默跳过审计会让「可选提示可审计」变成空话"
    );
  }

  // 无事务的旧路径：判定仍必须生效（阻止仍抛），只是跳过审计。
  // 若因为拿不到事务就把判定一起跳过，那就是 fail-open。
  {
    written.length = 0;
    const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]), fakeAudits);
    runtime.register({
      code: "delivery",
      order: 10,
      hooks: {
        order_confirmation: () => ({ decision: "block", blockReasons: [{ code: "x", message: "无事务也要拦" }] })
      }
    });
    await assert.rejects(
      runtime.evaluate({ ...evaluateInput(), tx: undefined }),
      /无事务也要拦/u,
      "无事务路径上阻止判定仍必须生效"
    );
    assert.equal(written.length, 0, "无事务时不得写审计");
  }
  console.log("  ✓ evaluate：阻止抛 409 且不落审计，放行用调用方事务落审计，无事务仍强制判定，缺仓储明确失败");
}

// ============ 11. CORE-EXT-02D：传入的能力快照优先于当前实例（在途订单按原版本履约） ============
{
  // 当前实例是 v2，但订单固化的快照是 v1。传入快照后，能力必须看到 v1——
  // 否则升级会悄悄改写在途订单的判定版本。
  const currentV2 = [instance("delivery", "enabled", { implementationVersion: "shared-2.0", configVersion: "v2", config: { maxKm: 50 } })];
  const pinnedV1 = [instance("delivery", "enabled", { implementationVersion: "shared-1.0", configVersion: "v1", config: { maxKm: 30 } })];
  const seen = {};
  const runtime = new CapabilityHookRuntime(fakeCapabilities(currentV2));
  runtime.register({
    code: "delivery",
    order: 10,
    hooks: {
      allocation_dispatch: (context) => {
        seen.version = context.capability.implementationVersion;
        seen.configVersion = context.capability.configVersion;
        seen.maxKm = context.capability.config.maxKm;
        return { decision: "allow" };
      }
    }
  });

  // 不传 instances：用当前实例 v2。
  await runtime.run(baseRun({ point: "allocation_dispatch" }));
  assert.equal(seen.version, "shared-2.0", "不传快照时应使用当前实例版本");

  // 传入订单固化的 v1 快照：必须覆盖当前实例。
  await runtime.run(baseRun({ point: "allocation_dispatch", instances: pinnedV1 }));
  assert.equal(seen.version, "shared-1.0", "传入快照后在途订单必须按快照版本判定，而不是升级后的当前版本");
  assert.equal(seen.configVersion, "v1", "配置版本也必须来自快照");
  assert.equal(seen.maxKm, 30, "配置本体必须来自快照");

  // 能力当前已全部停用（enabledInstances 为空），但传入快照仍让它执行——
  // 在途订单不因能力被暂停而中断履约。
  const pinnedStill = [instance("delivery", "enabled", { implementationVersion: "shared-1.0" })];
  const calls = [];
  const r2 = new CapabilityHookRuntime(fakeCapabilities([]));
  r2.register({ code: "delivery", order: 10, hooks: { allocation_dispatch: () => (calls.push("ran"), { decision: "allow" }) } });
  await r2.run(baseRun({ point: "allocation_dispatch", instances: pinnedStill }));
  assert.deepEqual(calls, ["ran"], "能力当前已停用时，在途订单仍按其固化快照继续履约");
  console.log("  ✓ 快照优先：在途订单按固化的实现版本/配置判定，且能力停用后仍继续履约");
}

console.log("\nCORE-EXT-02B Hook 运行时用例全部通过");
})();
