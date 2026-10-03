"use strict";
function order(overrides = {}) {
  return { id: "synthetic-order", tenantId: "synthetic-tenant", categoryCode: "camera", status: "settling",
    serviceSnapshots: [], feeReviews: [], finalPayableAmount: 100, ...overrides };
}
function exception(overrides = {}) { return { reviewStatus: "approved", approvedChargeAmount: 10, customerResponseStatus: "confirmed", ...overrides }; }
const blockers = [
  { name: "missing exception array", rows: [{ exceptions: undefined }], error: /事实格式无效/u },
  { name: "object instead of exception array", rows: [{ exceptions: {} }], error: /事实格式无效/u },
  { name: "null exception", rows: [{ exceptions: [null] }], error: /待审核/u },
  { name: "pending review", rows: [{ exceptions: [exception({ reviewStatus: "pending" })] }], error: /待审核/u },
  { name: "missing review", rows: [{ exceptions: [exception({ reviewStatus: undefined })] }], error: /待审核/u },
  { name: "string amount", rows: [{ exceptions: [exception({ approvedChargeAmount: "10" })] }], error: /金额无效/u },
  { name: "missing amount", rows: [{ exceptions: [exception({ approvedChargeAmount: undefined })] }], error: /金额无效/u },
  { name: "negative amount", rows: [{ exceptions: [exception({ approvedChargeAmount: -1 })] }], error: /金额无效/u },
  { name: "nonfinite amount", rows: [{ exceptions: [exception({ approvedChargeAmount: Infinity })] }], error: /金额无效/u },
  ...[undefined, "pending", "disputed", "not_required"].map(status => ({ name: `customer response ${status}`,
    rows: [{ exceptions: [exception({ customerResponseStatus: status })] }], error: /待客户确认/u }))
];
module.exports = { order, exception, blockers };
