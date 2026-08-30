const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  matchRuleVersionAt,
  resolveRuleVersionStatus,
  withResolvedRuleVersionStatuses,
  assertRuleEffectiveFromAvailable,
  assertRuleVersionEditable,
  assertRuleVersionPublishable,
  assertRuleVersionVoidable,
  isIssuedRuleVersion,
  nextRuleVersionNumber,
  previewRulePublish
} = require("../apps/api/src/modules/rental-core/rental-rule-version-chain");

/**
 * RULE-01A 专项：规则版本链的时点匹配、展示状态、发布冲突与状态机（需求 4.6.1、4.6.14）。
 *
 * 纯函数用例：匹配一旦出错，错的是已经对客户生效的条款；端到端报价只能证明总额，
 * 无法定位是「按租期开始时间匹配」这条判据本身错了还是别处。
 */

const ok = (message) => console.log(`  PASS  ${message}`);

const v = (over = {}) => ({
  id: over.id ?? `rule_${over.version ?? "x"}`,
  version: over.version ?? "1.0",
  status: over.status ?? "published",
  effectiveFrom: over.effectiveFrom
});

const rejects = (fn, pattern, label) => {
  assert.throws(fn, (error) => {
    assert.match(error.message, pattern, `${label}：实际 ${error.message}`);
    return true;
  }, label);
};

// ============ 1. 按租期开始时间匹配，未来租期套未来版本 ============
{
  const versions = [
    v({ version: "1.0", status: "superseded", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ version: "2.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    v({ version: "3.0", status: "pending", effectiveFrom: "2026-09-01T00:00:00.000Z" })
  ];
  // 5 月的租期必须命中 1 月生效的 v1，而不是「现在生效」的 v2。
  assert.equal(matchRuleVersionAt(versions, "2026-05-15T00:00:00.000Z").version, "1.0", "过去租期套当时生效的版本");
  assert.equal(matchRuleVersionAt(versions, "2026-07-01T00:00:00.000Z").version, "2.0", "当前租期套 v2");
  // 10 月的未来租期必须命中待生效的 v3——待生效也参与匹配，否则未来租期算不出规则。
  assert.equal(matchRuleVersionAt(versions, "2026-10-01T00:00:00.000Z").version, "3.0", "未来租期套待生效版本");
  ok("按租期开始时间匹配覆盖该时点的版本，待生效版本参与未来租期匹配");
}

// ============ 2. 匹配不到不回落，直接报错 ============
{
  const versions = [v({ version: "1.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" })];
  // 早于第一个生效时点：回落到「最近一条 published」会让客户签的与系统算的不是同一套规则。
  rejects(() => matchRuleVersionAt(versions, "2026-01-01T00:00:00.000Z"), /没有生效的租赁规则版本/u, "无覆盖必须报错而非回落");
  ok("租期开始时点没有任何生效版本时报错，绝不回落到最近版本");
}

// ============ 3. 同一时点两条版本，无法唯一确定必须报错 ============
{
  const versions = [
    v({ id: "a", version: "2.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    v({ id: "b", version: "2.1", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" })
  ];
  rejects(() => matchRuleVersionAt(versions, "2026-07-01T00:00:00.000Z"), /同时生效.*无法唯一确定/u, "重叠版本必须报错");
  ok("同一时点多条版本无法唯一确定时报错，不随机挑一条");
}

// ============ 4. 已作废版本不参与匹配 ============
{
  const versions = [
    v({ version: "1.0", status: "void", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ version: "2.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" })
  ];
  // 1 月租期：唯一覆盖它的 v1 已作废，因此报错而不是套用作废版本。
  rejects(() => matchRuleVersionAt(versions, "2026-03-01T00:00:00.000Z"), /没有生效的租赁规则版本/u, "作废版本不参与匹配");
  assert.equal(isIssuedRuleVersion("void"), false, "void 不算已发行");
  assert.equal(isIssuedRuleVersion("draft"), false, "draft 不算已发行");
  assert.equal(isIssuedRuleVersion("superseded"), true, "superseded 仍算已发行");
  ok("已作废版本被排除在匹配之外，草稿同样不参与");
}

// ============ 5. 展示状态按当前时间现算：待生效 / 已生效 / 已被替代 ============
{
  const versions = [
    v({ id: "a", version: "1.0", status: "published", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ id: "b", version: "2.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    v({ id: "c", version: "3.0", status: "pending", effectiveFrom: "2026-09-01T00:00:00.000Z" })
  ];
  const now = "2026-07-01T00:00:00.000Z";
  // v1 已被 v2 盖过（有更新的版本已生效）→ 已被替代。
  assert.equal(resolveRuleVersionStatus(versions[0], versions, now), "superseded", "被更新版本盖过→已被替代");
  // v2 此刻生效且无更新版本已生效（v3 还没到点）→ 已生效。
  assert.equal(resolveRuleVersionStatus(versions[1], versions, now), "published", "当前生效");
  // v3 生效时点在未来 → 待生效，即便它是时间轴上最后一条。
  assert.equal(resolveRuleVersionStatus(versions[2], versions, now), "pending", "未来生效→待生效");
  ok("展示状态按当前时间现算，不依赖库里存的滞后标签");
}

// ============ 6. 待生效的未来版本不让当前版本提前显示为已被替代 ============
{
  const versions = [
    v({ id: "a", version: "1.0", status: "published", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ id: "b", version: "2.0", status: "pending", effectiveFrom: "2026-12-01T00:00:00.000Z" })
  ];
  const now = "2026-07-01T00:00:00.000Z";
  // 关键回归：若把「不是最后一条」当作已被替代，当下就会没有任何生效规则。
  assert.equal(resolveRuleVersionStatus(versions[0], versions, now), "published", "待生效的未来版本不能让当前版本提前变已被替代");
  assert.equal(resolveRuleVersionStatus(versions[1], versions, now), "pending", "未来版本仍是待生效");
  const resolved = withResolvedRuleVersionStatuses(versions, now);
  assert.equal(resolved.filter((row) => row.status === "published").length, 1, "任意时刻恰有一条已生效");
  ok("待生效的未来版本不会把当前生效版本挤成已被替代");
}

// ============ 7. 草稿与作废原样返回，不被现算覆盖 ============
{
  const versions = [
    v({ id: "a", version: "1.0", status: "published", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ id: "d", version: "2.0", status: "draft", effectiveFrom: undefined }),
    v({ id: "x", version: "0.9", status: "void", effectiveFrom: "2025-01-01T00:00:00.000Z" })
  ];
  const now = "2026-07-01T00:00:00.000Z";
  assert.equal(resolveRuleVersionStatus(versions[1], versions, now), "draft", "草稿原样");
  assert.equal(resolveRuleVersionStatus(versions[2], versions, now), "void", "作废原样");
  ok("草稿与已作废不参与现算，状态原样保留");
}

// ============ 8. 发布生效时点校验：不得撞点、不得早于最新 ============
{
  const versions = [
    v({ id: "a", version: "1.0", status: "superseded", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ id: "b", version: "2.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" })
  ];
  // 撞点：与已发布版本共用同一生效时点正是匹配无法唯一确定的成因。
  rejects(
    () => assertRuleEffectiveFromAvailable(versions, "2026-06-01T00:00:00.000Z"),
    /已占用生效时点/u,
    "撞点必须拒绝"
  );
  // 往中间插：早于最新生效时点会改写已过时点该套哪份条款。
  rejects(
    () => assertRuleEffectiveFromAvailable(versions, "2026-03-01T00:00:00.000Z"),
    /必须晚于已发布的最新版本/u,
    "早于最新必须拒绝"
  );
  // 晚于最新：放行。
  assert.doesNotThrow(() => assertRuleEffectiveFromAvailable(versions, "2026-09-01T00:00:00.000Z"), "晚于最新应放行");
  // excludeId：重新发布自己时不该和自己撞点。
  assert.doesNotThrow(
    () => assertRuleEffectiveFromAvailable(versions, "2026-06-01T00:00:00.000Z", "b"),
    "排除自身后不算撞点"
  );
  ok("发布生效时点不得与已发布版本撞点，也不得早于已有最新生效时点");
}

// ============ 9. 状态机：编辑只认草稿，发布只认草稿，作废按展示状态 ============
{
  assert.doesNotThrow(() => assertRuleVersionEditable("draft", "1.0"), "草稿可编辑");
  rejects(() => assertRuleVersionEditable("published", "1.0"), /已发布或已作废.*不能直接修改/u, "已发布不可编辑");
  rejects(() => assertRuleVersionEditable("superseded", "1.0"), /不能直接修改/u, "已被替代不可编辑");

  assert.doesNotThrow(() => assertRuleVersionPublishable("draft", "1.0"), "草稿可发布");
  rejects(() => assertRuleVersionPublishable("published", "1.0"), /不是草稿，无法发布/u, "已发布不可再发布");

  // 作废按**展示状态**：待生效、已生效可作废；已被替代、草稿、已作废不可。
  assert.doesNotThrow(() => assertRuleVersionVoidable("published", "1.0"), "已生效可作废");
  assert.doesNotThrow(() => assertRuleVersionVoidable("pending", "1.0"), "待生效可作废");
  rejects(() => assertRuleVersionVoidable("superseded", "1.0"), /已被替代.*不能作废/u, "已被替代不可作废");
  rejects(() => assertRuleVersionVoidable("draft", "1.0"), /是草稿，不需要作废/u, "草稿不作废");
  rejects(() => assertRuleVersionVoidable("void", "1.0"), /已作废/u, "重复作废");
  ok("编辑/发布只认草稿，作废按展示状态放行待生效与已生效、拒绝已被替代");
}

// ============ 10. 版本号自增，永不复用 ============
{
  assert.equal(nextRuleVersionNumber([]), "0.1", "空集从 0.1 起");
  assert.equal(nextRuleVersionNumber([{ version: "1.0" }, { version: "2.0" }]), "2.1", "取最高号 +0.1");
  assert.equal(nextRuleVersionNumber([{ version: "2.0" }, { version: "1.5" }]), "2.1", "顺序无关取最高");
  ok("版本号取现有最高号 +0.1，恢复与发布都追加新号");
}

// ============ 11. 发布预览：被替代集合与安排生效判定 ============
{
  const versions = [
    v({ id: "a", version: "1.0", status: "published", effectiveFrom: "2026-01-01T00:00:00.000Z" }),
    v({ id: "b", version: "2.0", status: "published", effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    v({ id: "draft", version: "3.0", status: "draft", effectiveFrom: undefined })
  ];
  const now = "2026-07-01T00:00:00.000Z";
  // 立即生效：当前生效的是 v2，生效后 v1、v2 都被盖过。
  const immediate = previewRulePublish(versions, versions[2], now, now);
  assert.equal(immediate.scheduled, false, "立即生效");
  assert.equal(immediate.currentVersion, "2.0", "当前生效版本是 v2");
  assert.deepEqual(immediate.supersededVersions.sort(), ["1.0", "2.0"], "立即生效替代所有更早版本");
  // 安排未来生效：scheduled=true。
  const scheduled = previewRulePublish(versions, versions[2], "2026-12-01T00:00:00.000Z", now);
  assert.equal(scheduled.scheduled, true, "未来时点→安排生效");
  ok("发布预览给出当前生效版本、被替代集合与是否安排生效");
}

console.log("\nAll rule-version-chain assertions passed.");
