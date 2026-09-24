const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  verifyStripeSignature,
  parseStripeSignatureHeader,
  toStripeMinorUnits,
  mapStripeCheckoutStatus,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS
} = require("../apps/api/src/modules/integrations/stripe-payment");

const secret = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const nowMs = 1_700_000_000_000;
const nowSec = Math.floor(nowMs / 1000);
const sign = (ts, body, key = secret) => createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");

// 合法签名通过
assert.equal(
  verifyStripeSignature({ payload, header: `t=${nowSec},v1=${sign(nowSec, payload)}`, secret, nowMs }),
  true,
  "合法签名应通过"
);
// 篡改 body 失败
assert.equal(
  verifyStripeSignature({ payload: `${payload}x`, header: `t=${nowSec},v1=${sign(nowSec, payload)}`, secret, nowMs }),
  false,
  "篡改 body 应失败"
);
// 错误密钥失败
assert.equal(
  verifyStripeSignature({ payload, header: `t=${nowSec},v1=${sign(nowSec, payload, "whsec_wrong")}`, secret, nowMs }),
  false,
  "错误密钥应失败"
);
// 超出容差失败
{
  const oldTs = nowSec - STRIPE_SIGNATURE_TOLERANCE_SECONDS - 5;
  assert.equal(
    verifyStripeSignature({ payload, header: `t=${oldTs},v1=${sign(oldTs, payload)}`, secret, nowMs }),
    false,
    "过期时间戳应失败"
  );
}
// 只认 v1、忽略 v0(防降级):v0 匹配但 v1 不匹配 → 失败
assert.equal(
  verifyStripeSignature({ payload, header: `t=${nowSec},v0=${sign(nowSec, payload)},v1=deadbeef`, secret, nowMs }),
  false,
  "只认 v1,不认 v0"
);
// 轮换期多个 v1,任一匹配即通过
assert.equal(
  verifyStripeSignature({ payload, header: `t=${nowSec},v1=deadbeef,v1=${sign(nowSec, payload)}`, secret, nowMs }),
  true,
  "多个 v1 任一匹配即通过"
);
// 缺 t 或缺 v1 → 失败
assert.equal(verifyStripeSignature({ payload, header: `v1=${sign(nowSec, payload)}`, secret, nowMs }), false, "缺时间戳应失败");
assert.equal(verifyStripeSignature({ payload, header: `t=${nowSec}`, secret, nowMs }), false, "缺 v1 应失败");

// 头解析
const parsed = parseStripeSignatureHeader("t=123,v1=aa,v1=bb,v0=cc");
assert.equal(parsed.timestamp, 123);
assert.deepEqual(parsed.v1, ["aa", "bb"]);

// 金额换算:两位小数 ×100;特殊币种 fail-closed
assert.equal(toStripeMinorUnits(12.34, "USD"), 1234, "USD 两位小数 ×100");
assert.equal(toStripeMinorUnits(12.34, "hkd"), 1234, "币种大小写不敏感");
assert.throws(() => toStripeMinorUnits(100, "TWD"), /特殊最小单位/u, "TWD 特殊规则应 fail-closed");

// Checkout Session 状态映射
assert.deepEqual(mapStripeCheckoutStatus({ status: "complete", payment_status: "paid" }), { paid: true, closed: false });
assert.deepEqual(mapStripeCheckoutStatus({ status: "complete", payment_status: "no_payment_required" }), { paid: true, closed: false });
assert.deepEqual(mapStripeCheckoutStatus({ status: "expired", payment_status: "unpaid" }), { paid: false, closed: true });
assert.deepEqual(mapStripeCheckoutStatus({ status: "open", payment_status: "unpaid" }), { paid: false, closed: false });

console.log("stripe payment helper tests passed");