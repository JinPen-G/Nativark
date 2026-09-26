const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// ORDER-CLOSE-02 §4.2-4/5：把「裁定该收/该退多少」和「实际收退款」拆成两个权限，
// 并且「批准退款」不得在界面上显示成「已经退款」。
//
// 此前四类审核入口全部认 rental-os:order:settle，而资金事件也认它，
// 等于一个权限同时授予定金额与动钱——任何能结算的人都能改裁定，反之亦然。
const { requiredPermissions } = require("../apps/api/src/common/api-auth.guard");

/**
 * 管理端是 ESM 包（apps/admin 的 package.json 带 "type": "module"），CJS 专项没法直接
 * require 它的 .ts。这里把那一个模块按 CommonJS 转译后执行真实代码——它只有一个
 * `import type`，运行时零依赖，因此不需要解析别名或拉起 antd。
 * 这样断言的是**真实实现**，不是源码字符串。
 */
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

const { feeReviewStatusText, hasPendingFeeReview, FEE_REVIEW_TYPE_LABELS } =
  loadAdminModule("../apps/admin/src/features/rental-core/orderFeeReview.ts");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const FEE_REVIEW = "rental-os:order:fee-review";
const SETTLE = "rental-os:order:settle";
const VIEW = "rental-os:order:view";

const req = (method, path) => requiredPermissions(method, path);
/** 守卫放行语义：账号权限与要求集合有交集即通过（hasAnyPermission 用 some）。 */
const allows = (userPerms, required) => required.some((code) => userPerms.includes(code));

// 四条裁定入口 + 一条资金入口，覆盖 §4.2 要求区分的两种财务动作。
const FEE_ROUTES = {
  "订单费用审核": ["POST", "/rental/v1/orders/order_1/fee-reviews/review_1/review"],
  "续租负差额退款审核": ["POST", "/rental/v1/orders/order_1/extensions/ext_1/refund-review"],
  "检查异常费用审核": ["POST", "/rental/v1/orders/order_1/inspections/ins_1/exceptions/0/review"],
  "检查异常客户响应": ["POST", "/rental/v1/orders/order_1/inspections/ins_1/exceptions/0/customer-response"],
  "客户申诉金额复核": ["POST", "/rental/v1/orders/order_1/inspections/ins_1/exceptions/0/re-review"]
};
const FUNDING_WRITE = ["POST", "/rental/v1/orders/order_1/funding-events"];

/* ---------- 四条裁定入口统一收到 fee-review，不再靠 settle ---------- */

for (const [label, [method, path]] of Object.entries(FEE_ROUTES)) {
  const required = req(method, path);
  assert.deepEqual(required, [FEE_REVIEW], `${label} 必须只认 ${FEE_REVIEW}`);
}
ok("四条费用裁定入口都要求 order:fee-review——修复前它们都认 order:settle");

/* ---------- 资金动作仍只认 settle ---------- */

{
  const required = req(...FUNDING_WRITE);
  assert.deepEqual(required, [SETTLE], "资金事件写入仍只认 order:settle，不因拆权而放宽");
  ok("资金收退款仍只认 order:settle：拆权没有顺手把资金入口也放开");
}

/* ---------- 三种账号的放行矩阵 ---------- */

{
  const viewer = [VIEW];
  const reviewer = [VIEW, FEE_REVIEW];
  const cashier = [VIEW, SETTLE];
  for (const [label, [method, path]] of Object.entries(FEE_ROUTES)) {
    assert.equal(allows(viewer, req(method, path)), false, `只读账号不能裁定${label}`);
    assert.equal(allows(reviewer, req(method, path)), true, `有裁定权的账号必须能裁定${label}`);
    assert.equal(allows(cashier, req(method, path)), false, `只有资金权的账号不能改裁定结论（${label}）`);
  }
  assert.equal(allows(viewer, req(...FUNDING_WRITE)), false, "只读账号不能办理收退款");
  assert.equal(allows(reviewer, req(...FUNDING_WRITE)), false, "有裁定权但无资金权限的账号不能退款");
  assert.equal(allows(cashier, req(...FUNDING_WRITE)), true, "资金权账号必须能办理收退款");
  ok("放行矩阵成立：查看者不能裁定、裁定者不能退款、资金操作者不能改裁定");
}

/* ---------- 「批准退款」不能显示成「已经退款」 ---------- */

{
  const approvedRefund = feeReviewStatusText({ status: "approved", type: "early_return_refund" });
  assert.match(approvedRefund, /待实际退款/u, "批准退款必须明说仍待实际退款");
  assert.equal(approvedRefund.includes("已退款"), false, "不能出现「已退款」——钱还没出去");
  assert.match(approvedRefund, /应收已核减/u, "要说明批准的实际效果是核减应收");
  const approvedOverdue = feeReviewStatusText({ status: "approved", type: "overdue" });
  assert.match(approvedOverdue, /已计入应收/u, "批准逾期费的效果是计入应收，不是已收款");
  assert.equal(approvedOverdue.includes("已收款"), false, "不能把计入应收写成已收款");
  assert.equal(feeReviewStatusText({ status: "pending", type: "overdue" }), "待裁定");
  assert.match(feeReviewStatusText({ status: "rejected", type: "early_return_refund" }), /不退款/u, "驳回必须明说不退款");
  ok("裁定状态文字把「已裁定」与「已动钱」分开——批准退款只说应收已核减、待实际退款");
}

/* ---------- 待办判据只有一处 ---------- */

{
  assert.equal(hasPendingFeeReview({}), false, "没有审核事项的订单不算有待办");
  assert.equal(hasPendingFeeReview({ feeReviews: [] }), false);
  assert.equal(hasPendingFeeReview({ feeReviews: [{ status: "approved" }, { status: "rejected" }] }), false, "全部裁定完就不再是待办");
  assert.equal(hasPendingFeeReview({ feeReviews: [{ status: "approved" }, { status: "pending" }] }), true, "还有一项待裁定就是待办");
  ok("列表标记、列表筛选与详情页关单闸门共用同一个待办判据");
}

/* ---------- 两类事项的来源标签保持区分 ---------- */

{
  assert.notEqual(FEE_REVIEW_TYPE_LABELS.overdue, FEE_REVIEW_TYPE_LABELS.early_return_refund);
  assert.match(FEE_REVIEW_TYPE_LABELS.overdue, /逾期/u);
  assert.match(FEE_REVIEW_TYPE_LABELS.early_return_refund, /提前归还/u);
  assert.match(FEE_REVIEW_TYPE_LABELS.carrier_rental_refund, /承运寄送/u);
  assert.match(feeReviewStatusText({ status: "approved", type: "carrier_rental_refund" }), /待实际退款/u);
  ok("逾期人工核价与提前归还退款在界面上仍是两类来源，没有被合并成统一审批");
}


/* ---------- ORDER-CLOSE-02-UI：订单详情 UI 层的变异锁定 ---------- */

{
  // 用真实源码做静态断言：审核按钮必须以 order:fee-review 为门禁；
  // 成功/失败文案不得把「已裁定」写成「已退款/已收款」。
  const nodeFs = require("node:fs");
  const nodePath = require("node:path");
  const detailSource = nodeFs.readFileSync(
    nodePath.join(__dirname, "../apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx"),
    "utf8"
  );
  assert.match(detailSource, /hasPermission\("rental-os:order:fee-review"\)/u, "订单详情必须消费 order:fee-review 作为审核门禁");
  assert.match(detailSource, /canReviewFees/u, "待审费用的裁定按钮必须受 canReviewFees 控制");
  assert.match(detailSource, /仅核减应收/u, "扩展退款审核文案必须说明只核减应收");
  assert.match(detailSource, /不代表实际退款到账/u, "扩展退款审核必须说明不代表实际退款");
  assert.equal(/已退款到账|已实际退款/u.test(detailSource), false, "不得出现「已退款到账」类措辞");
  assert.match(detailSource, /被后续续租替代/u, "审核冲突提示必须点名「被后续续租替代」");
  const listSource = nodeFs.readFileSync(
    nodePath.join(__dirname, "../apps/admin/src/features/rental-core/RentalOrdersPage.tsx"),
    "utf8"
  );
  assert.match(listSource, /待裁定费用/u, "订单列表必须渲染待裁定标识");
  assert.match(listSource, /只看有待审费用的订单/u, "订单列表必须提供待审筛选");
  ok("订单详情 UI：审核按钮以 fee-review 权限为门禁；文案区分裁定与实际动钱；列表/工作台待审可发现");
}

console.log(`\n费用裁定权限与措辞专项：${passed} 项全部通过`);
