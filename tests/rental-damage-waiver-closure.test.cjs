const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: false, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { selectDamageWaiver } = require("../apps/api/src/modules/rental-core/rental-damage-waiver");
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreOrderStatus } = require("@rental-os/shared");

(async () => {
  const at = Date.parse("2026-10-02T12:00:00Z");
  const waiver = (overrides = {}) => ({ serviceId: "waiver", serviceType: "damage_waiver", deductible: 100, coverageLimit: 1000, ...overrides });
  const better = waiver({ serviceId: "lower-deductible", deductible: 10, coverageLimit: 500 });
  const worse = waiver({ serviceId: "higher-limit", deductible: 200, coverageLimit: 1000 });
  assert.equal(selectDamageWaiver([worse, better], 250, at).service.serviceId, "lower-deductible");
  assert.equal(selectDamageWaiver([better, worse], 250, at).customerAmount, 10);
  assert.equal(selectDamageWaiver([waiver({ scheduledStartAt: "2026-10-03T00:00:00Z" })], 250, at), undefined);
  assert.equal(selectDamageWaiver([waiver({ scheduledEndAt: "2026-10-01T00:00:00Z" })], 250, at), undefined);
  assert.equal(selectDamageWaiver([waiver({ scheduledStartAt: "2026-10-01T00:00:00Z" })], 250, at).customerAmount, 100);
  assert.equal(selectDamageWaiver([waiver({ quantity: 0 })], 250, at), undefined);
  assert.equal(selectDamageWaiver([waiver({ applicableItemGroupIds: ["group-a"] })], 250, at, "group-b"), undefined);
  for (const overrides of [{ scheduledStartAt: "invalid" }, { scheduledStartAt: "2026-10-03T00:00:00Z", scheduledEndAt: "2026-10-01T00:00:00Z" },
    { deductible: -1 }, { deductible: Infinity }, { coverageLimit: NaN }, { coverageLimit: -1 }]) {
    assert.throws(() => selectDamageWaiver([waiver(overrides)], 250, at), /无效/u);
  }
  assert.equal(selectDamageWaiver([waiver({ coverageLimit: 0 })], 250, at).customerAmount, 250);

  const service = Object.create(RentalCoreService.prototype);
  const order = { id: "order", status: RentalCoreOrderStatus.Settling, ruleVersion: "v1", ruleSnapshot: { damage: { chargeLimit: 500 } },
    payableAmount: 100, adjustmentAmount: 100, finalPayableAmount: 200, totalAmount: 200, taxRate: 0,
    chargeLines: [{ code: "damage:order:inspection:0", type: "damage", amount: 100 }] };
  service.lockedOrder = async () => order;
  let saved = 0;
  service.factStore = { saveOrderAggregate: async () => saved++ };
  const adjust = (previous, amount, sequence, ceiling) => service.adjustInspectionExceptionCharge(
    "tenant", "order", "inspection", 0, previous, 400, amount, "证据复核", "operator", sequence, {}, ceiling
  );
  await assert.rejects(() => adjust(100, 200, 1, 100), /免赔裁定/u);
  await assert.rejects(() => adjust(90, 50, 1), /费用净额不一致/u);
  await assert.rejects(() => adjust(100, 50, 0), /序号无效/u);
  assert.equal(saved, 0);
  await adjust(100, 60, 1, 100);
  assert.equal(order.finalPayableAmount, 160);
  await assert.rejects(() => adjust(60, 40, 1, 100), /序号无效/u);
  await adjust(60, 80, 2, 100);
  assert.equal(order.finalPayableAmount, 180);
  assert.equal(order.chargeLines.reduce((sum, line) => sum + line.amount, 0), 80);
  assert.equal(saved, 2);
  const assessedOrder = { id: "waiver-order", startAt: "2026-10-01T00:00:00Z", status: RentalCoreOrderStatus.Settling,
    payableAmount: 100, adjustmentAmount: 0, finalPayableAmount: 100, totalAmount: 100, taxRate: 0,
    ruleVersion: "v1", ruleSnapshot: { damage: {} }, chargeLines: [], serviceSnapshots: [
      waiver({ occurrenceId: "original", termsVersion: "terms-1", scheduledStartAt: "2026-10-01T00:00:00Z", scheduledEndAt: "2026-10-02T00:00:00Z" }),
      waiver({ occurrenceId: "extension", termsVersion: "terms-2", deductible: 200, scheduledStartAt: "2026-10-02T00:00:00Z", scheduledEndAt: "2026-10-04T00:00:00Z" })
    ] };
  service.lockedOrder = async () => assessedOrder;
  const assess = (context) => service.approveInspectionException("tenant", assessedOrder.id, "incident", 0, 250,
    "已核验损失", {}, "2026-10-03T12:00:00Z", { liability: "customer", waiverDecision: "covered", ...context });
  await assert.rejects(() => assess({}), /实际事故时间与核实依据/u);
  await assert.rejects(() => assess({ incidentAt: "2026-10-01T12:00:00Z", incidentBasis: "  " }), /实际事故时间与核实依据/u);
  await assert.rejects(() => assess({ incidentAt: "2026-10-04T12:00:00Z", incidentBasis: "客户陈述" }), /事故时间必须/u);
  await assert.rejects(() => assess({ incidentAt: "2026-09-30T12:00:00Z", incidentBasis: "客户陈述" }), /事故时间必须/u);
  await assert.rejects(() => assess({ incidentAt: "2026-10-01T12:00:00Z", incidentBasis: "客户陈述", waiverOccurrenceId: "other-order" }), /不属于该订单/u);
  await assert.rejects(() => assess({ incidentAt: "2026-10-01T12:00:00Z", incidentBasis: "客户陈述", waiverOccurrenceId: "extension" }), /没有覆盖该事故/u);
  assert.equal(assessedOrder.chargeLines.length, 0);
  const assessed = await assess({ incidentAt: "2026-10-01T12:00:00Z", incidentBasis: "事故记录与照片一致", waiverOccurrenceId: "original" });
  assert.equal(assessed.approvedChargeAmount, 100, "期后检查必须使用实际事故期的原保障，不是检查期续租保障");
  assert.equal(assessed.waiverOccurrenceId, "original");
  assert.equal(assessed.waiverTermsVersion, "terms-1");
  assert.equal(assessed.incidentBasis, "事故记录与照片一致");
  assert.match(assessedOrder.chargeLines[0].detail, /2026-10-01T12:00:00Z/u);
  const savedAfterAssessment = saved;
  const originalAssessment = structuredClone(assessedOrder);
  await assert.rejects(() => assess({ incidentAt: "2026-10-01T12:00:00Z", incidentBasis: "重复裁定", waiverOccurrenceId: "original" }), /已入账/u);
  assert.equal(saved, savedAfterAssessment, "重复初审不写聚合");
  assert.deepEqual(assessedOrder, originalAssessment, "重复初审不能更改金额与裁定事实");
  await service.approveInspectionException("tenant", assessedOrder.id, "preexisting", 0, 0,
    "既有损伤不向客户收费", {}, "2026-09-30T12:00:00Z", { liability: "lessor" });
  assert.equal(assessedOrder.chargeLines.length, 1, "起租前既有损伤可零额驳回，不产生费用");
  console.log("damage waiver closure passed: selection, interval bounds, frozen values, scope, ceiling, ledger consistency and adjustment sequence");
})().catch((error) => { console.error(error); process.exitCode = 1; });
