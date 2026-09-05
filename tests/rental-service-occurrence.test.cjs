const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// MKT-02C §4.3-2：每次服务发生都要有稳定标识、来源、关联续租、版本、时段、金额与容量依据，
// 并且**同一 serviceId 的不同次发生必须可区分**——不能用只按 serviceId 的 Map 覆写前次。
const {
  serviceReservationKey,
  extensionRequestKey,
  occurrenceIdOf,
  stampOccurrences,
  appendOccurrences
} = require("../apps/api/src/modules/rental-core/rental-service-occurrence");

/** 管理端是 ESM 包，CJS 专项按 CommonJS 转译后执行真实代码（该模块运行时零依赖）。 */
function loadAdminModule(relativePath) {
  const ts = require("typescript");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exported = {};
  new Function("exports", "require", compiled)(exported, require);
  return exported;
}
const { serviceOccurrenceOriginText, serviceOccurrenceNetAmount, serviceOccurrenceCount } =
  loadAdminModule("../apps/admin/src/features/rental-core/orderServiceOccurrence.ts");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const snapshot = (overrides = {}) => ({
  serviceId: "svc_1", serviceCode: "SVC1", serviceName: "驻场助理", serviceType: "other",
  serviceVersion: "1.0", termsVersion: "1.0", workspaceId: "ws_1",
  unitPrice: 100, quantity: 1, billingUnits: 2, amount: 200,
  requiresCapacity: true, capacityQuantity: 1,
  scheduledStartAt: "2040-03-01T00:00:00.000Z", scheduledEndAt: "2040-03-03T00:00:00.000Z",
  serviceLocationId: "loc_1",
  ...overrides
});

/* ---------- 容量依据：同一输入同一键，时段/地点变了就是另一条占用 ---------- */

{
  const base = snapshot();
  const key = serviceReservationKey("extension:ext_1", base);
  assert.equal(key, serviceReservationKey("extension:ext_1", base), "同一输入必须得到同一个键，否则重试会重复占容量");
  assert.notEqual(key, serviceReservationKey("extension:ext_2", base), "不同续租是不同占用");
  assert.notEqual(key, serviceReservationKey("extension:ext_1", snapshot({ scheduledStartAt: "2040-03-05T00:00:00.000Z" })), "换时段就是另一条占用");
  assert.notEqual(key, serviceReservationKey("extension:ext_1", snapshot({ serviceLocationId: "loc_2" })), "换地点就是另一条占用");
  assert.match(key, /^service-capacity:[0-9a-f]{64}$/u, "键格式必须与容量服务写进 idempotencyKey 的那个一致");
  ok("容量依据按「请求键 + 服务 + 地点 + 时段」派生，重试同键、换时段换地点换键");
}

/* ---------- 发生项字段齐全，且容量依据与容量服务同源 ---------- */

{
  const [occurrence] = stampOccurrences([snapshot()], {
    origin: "extension", ownerId: "ext_7", requestKey: extensionRequestKey("ext_7"), extensionId: "ext_7", extensionSequence: 3
  });
  assert.equal(occurrence.occurrenceId, occurrenceIdOf("extension", "ext_7", "svc_1", 0), "稳定标识");
  assert.equal(occurrence.origin, "extension");
  assert.equal(occurrence.extensionId, "ext_7");
  assert.equal(occurrence.extensionSequence, 3, "要能追溯到第几次续租");
  assert.equal(occurrence.reservationKey, serviceReservationKey("extension:ext_7", snapshot()), "容量依据必须与容量服务用的键一致，否则归还结算配不上");
  assert.equal(occurrence.serviceVersion, "1.0");
  assert.equal(occurrence.termsVersion, "1.0");
  assert.equal(occurrence.workspaceId, "ws_1", "空间必须随发生项固化，跨空间不可引用");
  assert.equal(occurrence.billingUnits, 2);
  assert.equal(occurrence.unitPrice, 100);
  ok("发生项带齐稳定标识、来源、关联续租、版本、时段、单价单位数与容量依据");
}

{
  const [occurrence] = stampOccurrences([snapshot({ requiresCapacity: false })], {
    origin: "order", ownerId: "order_1", requestKey: "order-key-1"
  });
  assert.equal(occurrence.reservationKey, undefined, "不需要容量的服务没有预留行，也就不该编一个容量依据出来");
  assert.equal(occurrence.origin, "order");
  ok("不需要容量的服务不带容量依据，不伪造占用");
}

/* ---------- 追加而不覆盖：同一 serviceId 的两次发生都要留下 ---------- */

{
  const original = stampOccurrences([snapshot({ serviceVersion: "1.0", amount: 200 })], {
    origin: "order", ownerId: "order_1", requestKey: "order-key-1"
  });
  const added = stampOccurrences([snapshot({ serviceVersion: "2.0", amount: 350, scheduledStartAt: "2040-03-06T00:00:00.000Z", scheduledEndAt: "2040-03-08T00:00:00.000Z" })], {
    origin: "extension", ownerId: "ext_9", requestKey: extensionRequestKey("ext_9"), extensionId: "ext_9", extensionSequence: 1
  });
  const merged = appendOccurrences(original, added);
  assert.equal(merged.length, 2, "同一 serviceId 的两次发生必须都在——按 serviceId 覆盖是本项要修的缺陷");
  assert.deepEqual(merged.map((row) => row.serviceVersion), ["1.0", "2.0"], "各自的服务版本不互相改写");
  assert.deepEqual(merged.map((row) => row.amount), [200, 350], "各自的金额不互相改写");
  assert.notEqual(merged[0].reservationKey, merged[1].reservationKey, "各自对应独立的容量预留");
  ok("发生项只追加不覆盖：同一服务两次购买各自保留版本、金额与容量依据");
}

{
  const once = stampOccurrences([snapshot()], {
    origin: "extension", ownerId: "ext_r", requestKey: extensionRequestKey("ext_r"), extensionId: "ext_r", extensionSequence: 1
  });
  const twice = appendOccurrences(appendOccurrences([], once), once);
  assert.equal(twice.length, 1, "同一次发生重复提交是重试，只能留一条");
  ok("重复同一请求复用发生项，不重复记履约承诺、不重复占容量");
}

/* ---------- 管理端展示：来源可辨认、净额只算客户实付 ---------- */

{
  assert.equal(serviceOccurrenceOriginText({ origin: "order" }), "原订单服务");
  assert.equal(serviceOccurrenceOriginText({ origin: "extension", extensionSequence: 2 }), "第 2 次续租新增");
  assert.equal(serviceOccurrenceOriginText({ origin: "extension" }), "续租新增");
  assert.match(serviceOccurrenceOriginText({}), /无来源标记/u, "存量记录不猜来源");
  ok("界面能区分原订单服务与第几次续租新增，存量记录不瞎猜来源");
}

{
  assert.equal(serviceOccurrenceNetAmount({ amount: 200 }), 200, "没有减免时净额等于原价");
  assert.equal(serviceOccurrenceNetAmount({ amount: 200, discountAllocatedAmount: 30, couponAllocatedAmount: 20 }), 150,
    "净额必须扣掉优惠与券——按原价退款等于把平台自己出的优惠也退给客户");
  assert.equal(serviceOccurrenceCount([{ serviceId: "a" }, { serviceId: "a" }, { serviceId: "b" }], "a"), 2,
    "同一服务发生两次是事实，不是重复记录");
  ok("净额按原价减优惠减券算，同一服务的发生次数可数");
}

console.log(`\n服务发生项与容量依据专项：${passed} 项全部通过`);
