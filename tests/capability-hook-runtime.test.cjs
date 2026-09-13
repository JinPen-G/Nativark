const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { CapabilityHookRuntime } = require("../apps/api/src/modules/rental-core/capability-hook.runtime");
const { RENTAL_CAPABILITY_HOOK_POINTS } = require("@rental-os/shared");

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
    () => runtime.register({ code: "not_a_capability", implementationVersion: "core-1.0", order: 10, hooks: { quote_validation: () => ({ decision: "allow" }) } }),
    /未注册的能力/u,
    "拼错的 code 必须直接失败，否则会被静默登记成永不执行的 Hook"
  );
  assert.throws(
    () => runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 10, hooks: {} }),
    /没有任何触发点/u,
    "登记了 Hook 却没有触发点属配置错误"
  );
  runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 10, hooks: { quote_validation: () => ({ decision: "allow" }) } });
  assert.throws(
    () => runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 20, hooks: { quote_validation: () => ({ decision: "allow" }) } }),
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
  runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 10, hooks: { quote_validation: record("delivery") } });
  runtime.register({ code: "locker", implementationVersion: "core-1.0", order: 20, hooks: { quote_validation: record("locker") } });
  runtime.register({ code: "usage_reading", implementationVersion: "core-1.0", order: 30, hooks: { quote_validation: record("usage_reading") } });
  runtime.register({ code: "qualification", implementationVersion: "core-1.0", order: 40, hooks: { quote_validation: record("qualification") } });

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
    implementationVersion: "core-1.0",
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
    runtime.register({ code: "usage_reading", implementationVersion: "core-1.0", order: 5, hooks: { quote_validation: () => (calls.push("usage_reading"), { decision: "allow" }) } });
    runtime.register({ code: "locker", implementationVersion: "core-1.0", order: 10, hooks: { quote_validation: () => (calls.push("locker"), { decision: "allow" }) } });
    runtime.register({ code: "qualification", implementationVersion: "core-1.0", order: 10, hooks: { quote_validation: () => (calls.push("qualification"), { decision: "allow" }) } });
    runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 1, hooks: { quote_validation: () => (calls.push("delivery"), { decision: "allow" }) } });
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
    implementationVersion: "core-1.0",
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

// 配置同样可能包含嵌套关系数组，不能只冻结顶层对象。
{
  const liveInstance = instance("delivery");
  liveInstance.config = { relations: [{ id: "r1", reason: "原始" }] };
  let nestedConfigError;
  const runtime = new CapabilityHookRuntime(fakeCapabilities([liveInstance]));
  runtime.register({
    code: "delivery",
    implementationVersion: "core-1.0",
    order: 10,
    hooks: {
      order_confirmation: (context) => {
        try {
          (function () {
            "use strict";
            context.capability.config.relations.push({ id: "r2" });
          })();
        } catch (error) {
          nestedConfigError = error;
        }
        return { decision: "allow" };
      }
    }
  });
  await runtime.run(baseRun({ point: "order_confirmation" }));
  assert.ok(nestedConfigError, "嵌套配置数组必须被冻结");
  assert.deepEqual(liveInstance.config.relations, [{ id: "r1", reason: "原始" }], "Hook 不得污染能力实例配置");
  console.log("  ✓ 配置快照：结构化关系被深克隆、深冻结，Hook 无法污染历史配置");
}

// ============ 6. 必选能力 fail-closed，可选能力降级放行 ============
{
  // serialized_inventory 是 category_required；delivery 是 shared（非必选）。
  const runtime = new CapabilityHookRuntime(
    fakeCapabilities([instance("serialized_inventory"), instance("delivery")])
  );
  runtime.register({
    code: "serialized_inventory",
    implementationVersion: "core-1.0",
    order: 10,
    hooks: {
      order_confirmation: () => {
        throw new Error("库存服务不可用");
      }
    }
  });
  runtime.register({
    code: "delivery",
    implementationVersion: "core-1.0",
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

// ============ 6b. shared 能力可由具体品类声明为必选 ============
{
  // bundle_inventory 的模块类型是 shared/category_optional，但摄影品类把它列入 requiredCapabilities。
  const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("bundle_inventory")]));
  runtime.register({
    code: "bundle_inventory",
    implementationVersion: "core-1.0",
    order: 10,
    hooks: { order_confirmation: () => { throw new Error("套装库存故障"); } }
  });
  const outcome = await runtime.run(baseRun({ point: "order_confirmation", categoryCode: "camera" }));
  assert.equal(outcome.blocked, true, "被摄影品类列为必选的共享能力故障必须 fail-closed");
  assert.equal(outcome.blockReasons[0]?.capability, "bundle_inventory");
  console.log("  ✓ 品类级必选：共享能力在被当前品类列为 required 时故障同样 fail-closed");
}

// ============ 7. 结果契约的运行期校验 ============
{
  const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]));
  let payload = { decision: "block" };
  runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 10, hooks: { quote_validation: () => payload } });

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
    implementationVersion: "core-1.0",
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
    // 实例固化的是 shared-2.0，因此必须登记同名版本才能被解析到。
    // 版本不一致时运行时会 fail-closed（第 11 节专门验证），不会退回其他版本。
    implementationVersion: "shared-2.0",
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
      implementationVersion: "core-1.0",
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
      implementationVersion: "core-1.0",
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
    runtime.register({ code: "delivery", implementationVersion: "core-1.0", order: 10, hooks: { order_confirmation: () => ({ decision: "allow" }) } });
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
      implementationVersion: "core-1.0",
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

// ============ 11. 快照版本必须选中对应实现（行为隔离，而不是只读版本号） ============
{
  // 两个版本的**行为不同**：v1 放行，v2 收紧为阻止。
  // 只比较 context.capability.implementationVersion 字符串是证明不了隔离的——
  // 那种测试在「运行时按 code 取唯一 handler」的实现下同样会绿。
  const buildRuntime = (currentInstances, register = ["shared-1.0", "shared-2.0"]) => {
    const calls = [];
    const runtime = new CapabilityHookRuntime(fakeCapabilities(currentInstances));
    if (register.includes("shared-1.0")) {
      runtime.register({
        code: "delivery",
        implementationVersion: "shared-1.0",
        order: 10,
        hooks: {
          allocation_dispatch: (context) => {
            calls.push(`v1:${context.capability.configVersion}:${context.capability.config.maxKm}`);
            return { decision: "allow" };
          }
        }
      });
    }
    if (register.includes("shared-2.0")) {
      runtime.register({
        code: "delivery",
        implementationVersion: "shared-2.0",
        order: 10,
        hooks: {
          allocation_dispatch: (context) => {
            calls.push(`v2:${context.capability.configVersion}:${context.capability.config.maxKm}`);
            return { decision: "block", blockReasons: [{ code: "v2_tightened", message: "v2 收紧了配送半径规则" }] };
          }
        }
      });
    }
    return { runtime, calls };
  };

  const currentV2 = [instance("delivery", "enabled", { implementationVersion: "shared-2.0", configVersion: "v2", config: { maxKm: 50 } })];
  const pinnedV1 = [instance("delivery", "enabled", { implementationVersion: "shared-1.0", configVersion: "v1", config: { maxKm: 30 } })];

  // 同一 code 可以登记多个版本，且互不覆盖。
  {
    const { runtime } = buildRuntime(currentV2);
    assert.deepEqual(
      runtime.registeredVersions(),
      ["delivery@shared-1.0", "delivery@shared-2.0"],
      "同一能力的多个版本必须共存，否则旧版本一发布就没了"
    );
    assert.deepEqual(runtime.registeredCodes(), ["delivery"], "registeredCodes 仍按能力去重");
  }

  // 新业务（不传快照）→ 当前实例 v2 → 必须执行 v2 的实现并被它阻止。
  {
    const { runtime, calls } = buildRuntime(currentV2);
    const outcome = await runtime.run(baseRun({ point: "allocation_dispatch" }));
    assert.deepEqual(calls, ["v2:v2:50"], "新业务必须执行当前版本 v2 的实现");
    assert.equal(outcome.blocked, true, "v2 的行为是阻止，新业务必须真的被阻止");
    assert.equal(outcome.blockReasons[0].code, "v2_tightened");
    assert.equal(outcome.executed[0].implementationVersion, "shared-2.0");
  }

  // 在途业务（传 v1 快照）→ 必须执行 v1 的实现，且**不被 v2 的新规则阻止**。
  // 这是与旧实现的分水岭：旧实现会调用同一个 handler，于是这里会被 v2 阻止。
  {
    const { runtime, calls } = buildRuntime(currentV2);
    const outcome = await runtime.run(baseRun({ point: "allocation_dispatch", instances: pinnedV1 }));
    assert.deepEqual(calls, ["v1:v1:30"], "在途业务必须执行快照固化的 v1 实现，配置也来自快照");
    assert.equal(outcome.blocked, false, "升级到 v2 不得改写在途业务的判定结果");
    assert.equal(outcome.executed[0].implementationVersion, "shared-1.0", "审计里记的是实际执行的版本");
  }

  // 旧版本被删（只登记 v2）→ 引用 v1 的在途业务必须**明确失败**，
  // 绝不能静默退回 v2 用新规则重放历史。
  {
    const { runtime, calls } = buildRuntime(currentV2, ["shared-2.0"]);
    const outcome = await runtime.run(baseRun({ point: "allocation_dispatch", instances: pinnedV1 }));
    assert.deepEqual(calls, [], "快照版本不存在时不得执行任何其他版本");
    assert.equal(outcome.blocked, true, "快照版本缺失必须 fail-closed");
    assert.equal(outcome.blockReasons[0].code, "capability_implementation_version_missing");
    assert.match(outcome.blockReasons[0].message, /shared-1\.0/u, "错误必须点明缺的是哪个版本");
    assert.match(outcome.blockReasons[0].message, /shared-2\.0/u, "错误必须列出实际登记了哪些版本");
    assert.equal(outcome.executed[0].failed, true, "版本缺失属基础设施问题，必须标记 failed 而不是伪装成业务判定");
  }

  // 完全没有登记 Hook 的能力（三种库存、取还等由 Core 主流程实现的能力）→ 静默跳过，
  // 不能与「缺版本」混为一谈，否则每张订单都会被这些能力阻止。
  {
    const runtime = new CapabilityHookRuntime(
      fakeCapabilities([instance("serialized_inventory", "enabled", { implementationVersion: "core-1.0" })])
    );
    const outcome = await runtime.run(baseRun({ point: "allocation_dispatch" }));
    assert.equal(outcome.blocked, false, "没有任何 Hook 实现的能力不参与判定，不得阻止");
    assert.deepEqual(outcome.executed, [], "它也不该出现在 executed 里");
  }

  // 发布自检：注册表当前版本没有实现时必须启动即失败。
  {
    const { runtime } = buildRuntime(currentV2, ["shared-1.0"]);
    // delivery 在生产注册表里没有 implementationVersion，因此自检跳过它；
    // 用一个当前版本为 core-1.0 的能力来验证自检真的会报。
    runtime.register({ code: "pickup", implementationVersion: "core-0.9", order: 5, hooks: { allocation_dispatch: () => ({ decision: "allow" }) } });
    assert.throws(
      () => runtime.assertCurrentVersionsRegistered(),
      /注册表当前实现版本是 core-1\.0/u,
      "升了注册表版本却没发实现时必须启动即失败，而不是等第一张订单 fail-closed"
    );
  }
  console.log("  ✓ 版本化实现：多版本共存、新业务走当前版、在途走快照版（行为不同可分辨）、缺版本 fail-closed、无 Hook 静默跳过、发布自检报错");
}

// ============ 12. 运行时独立兜底适用品类（不只在启用接口校验） ============
{
  // camera_compatibility 的 applicableCategories 是 [camera]。
  // 若一条错误的实例或快照把它带到别的品类上，运行时必须自己拒绝——
  // 只靠「启用时校验」的话，一条脏快照就能让能力在它根本不适用的品类上判定。
  const camInstance = [instance("camera_compatibility", "enabled", { implementationVersion: "cam-1.0" })];
  const build = () => {
    const calls = [];
    const runtime = new CapabilityHookRuntime(fakeCapabilities(camInstance));
    runtime.register({
      code: "camera_compatibility",
      implementationVersion: "cam-1.0",
      order: 20,
      hooks: { order_confirmation: () => (calls.push("ran"), { decision: "allow" }) }
    });
    return { runtime, calls };
  };

  // 适用品类：正常执行。
  {
    const { runtime, calls } = build();
    const outcome = await runtime.run(baseRun({ point: "order_confirmation", categoryCode: "camera" }));
    assert.deepEqual(calls, ["ran"], "适用品类下必须正常执行");
    assert.equal(outcome.blocked, false);
  }

  // 不适用品类：不得执行，且必须明确拒绝而不是静默跳过。
  for (const categoryCode of ["camping", "vehicle", "construction"]) {
    const { runtime, calls } = build();
    const outcome = await runtime.run(baseRun({ point: "order_confirmation", categoryCode }));
    assert.deepEqual(calls, [], `${categoryCode} 品类下不得执行仅适用于 camera 的能力`);
    assert.equal(outcome.blocked, true, `${categoryCode} 品类下必须 fail-closed`);
    assert.equal(outcome.blockReasons[0].code, "capability_not_applicable_to_category");
    assert.match(outcome.blockReasons[0].message, new RegExp(categoryCode, "u"), "错误必须点明是哪个品类");
    assert.equal(outcome.executed[0].failed, true, "数据不一致属基础设施问题，必须标记 failed");
  }

  // applicableCategories 为 "all" 的共享能力在任何品类都可执行。
  {
    const calls = [];
    const runtime = new CapabilityHookRuntime(fakeCapabilities([instance("delivery")]));
    runtime.register({
      code: "delivery",
      implementationVersion: "core-1.0",
      order: 10,
      hooks: { order_confirmation: () => (calls.push("ran"), { decision: "allow" }) }
    });
    await runtime.run(baseRun({ point: "order_confirmation", categoryCode: "vehicle" }));
    assert.deepEqual(calls, ["ran"], "applicableCategories 为 all 的能力不受品类限制");
  }
  console.log("  ✓ 适用品类兜底：适用则执行，不适用则拒绝执行并明确报错，shared 能力不受限");
}

// ============ 13. 能力已被停用，但在途订单仍按固化快照履约 ============
{
  // 当前 enabledInstances 为空（能力已被暂停或停用），传入订单固化的快照后仍必须执行：
  // 否则运营暂停一个能力就会让所有在途订单中途改变履约规则。
  const pinned = [instance("delivery", "enabled", { implementationVersion: "shared-1.0", configVersion: "v3", config: { maxKm: 42 } })];
  const seen = [];
  const runtime = new CapabilityHookRuntime(fakeCapabilities([]));
  runtime.register({
    code: "delivery",
    implementationVersion: "shared-1.0",
    order: 10,
    hooks: {
      allocation_dispatch: (context) => {
        seen.push(`${context.capability.implementationVersion}:${context.capability.configVersion}:${context.capability.config.maxKm}`);
        return { decision: "allow" };
      }
    }
  });

  // 不传快照 → 当前没有任何已启用能力 → 什么都不执行。
  const withoutSnapshot = await runtime.run(baseRun({ point: "allocation_dispatch" }));
  assert.deepEqual(seen, [], "能力已停用且不带快照时不得执行");
  assert.deepEqual(withoutSnapshot.executed, []);

  // 传快照 → 按快照继续履约，版本与配置都来自快照。
  await runtime.run(baseRun({ point: "allocation_dispatch", instances: pinned }));
  assert.deepEqual(seen, ["shared-1.0:v3:42"], "能力停用后，在途订单仍按其固化快照继续履约");
  console.log("  ✓ 停用不破坏在途：无快照不执行，带快照按原版本与原配置继续履约");
}

console.log("\nCORE-EXT-02B Hook 运行时用例全部通过");
})();
