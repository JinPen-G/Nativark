const assert = require("node:assert/strict");

const orders = [
  {
    mainStatus: "reserved",
    billingMode: "monthly",
    riskFlags: [],
    fees: [
      { direction: "charge", amount: 1000, pendingAmount: 1000, status: "monthly_billing" }
    ],
    transactions: [{ type: "monthly_bill", status: "success", amount: 1000 }]
  },
  {
    mainStatus: "payment_due",
    billingMode: "customer_pay",
    riskFlags: ["待补缴"],
    fees: [
      { direction: "charge", amount: 800, pendingAmount: 0, status: "settled" },
      { direction: "charge", amount: 200, pendingAmount: 200, status: "pending" }
    ],
    transactions: [{ type: "payment", status: "success", amount: 800 }]
  },
  {
    mainStatus: "accident_processing",
    billingMode: "customer_pay",
    riskFlags: ["事故出险"],
    fees: [{ direction: "charge", amount: 500, pendingAmount: 500, status: "pending" }],
    transactions: []
  }
];

function summarize(input) {
  return input.reduce(
    (result, order) => {
      result.totalOrders += 1;
      if (["pending_payment", "reserved", "pickup_overdue"].includes(order.mainStatus)) {
        result.pendingOrders += 1;
      }
      if (["settlement_pending", "payment_due", "refund_pending"].includes(order.mainStatus)) {
        result.settlementOrders += 1;
      }
      if (
        ["overdue", "accident_processing"].includes(order.mainStatus) ||
        order.riskFlags.length > 0
      ) {
        result.riskOrders += 1;
      }
      if (order.billingMode === "monthly") {
        result.monthlyOrders += 1;
      }
      for (const fee of order.fees) {
        if (fee.direction === "charge") {
          result.receivableAmount += fee.amount;
        }
        if (["pending", "monthly_billing"].includes(fee.status)) {
          result.pendingAmount += fee.pendingAmount;
        }
      }
      for (const transaction of order.transactions) {
        if (["payment", "pre_auth_capture", "monthly_bill"].includes(transaction.type)) {
          result.settledAmount += transaction.amount;
        }
        if (transaction.type === "monthly_bill") {
          result.monthlyBillingAmount += transaction.amount;
        }
      }
      return result;
    },
    {
      totalOrders: 0,
      pendingOrders: 0,
      settlementOrders: 0,
      riskOrders: 0,
      monthlyOrders: 0,
      receivableAmount: 0,
      settledAmount: 0,
      pendingAmount: 0,
      monthlyBillingAmount: 0
    }
  );
}

const summary = summarize(orders);

assert.equal(summary.totalOrders, 3);
assert.equal(summary.pendingOrders, 1);
assert.equal(summary.settlementOrders, 1);
assert.equal(summary.riskOrders, 2);
assert.equal(summary.monthlyOrders, 1);
assert.equal(summary.receivableAmount, 2500);
assert.equal(summary.settledAmount, 1800);
assert.equal(summary.pendingAmount, 1700);
assert.equal(summary.monthlyBillingAmount, 1000);

console.log("reports metrics fixture passed");
