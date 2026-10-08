"use strict";
function row(overrides = {}) {
  return { id: "synthetic-inspection", tenantId: "synthetic-tenant", workspaceId: "synthetic-workspace", orderId: "synthetic-order",
    exceptions: [{ reviewStatus: "approved", approvedChargeAmount: 10, customerResponseStatus: "pending", ...overrides }] };
}
function request(overrides = {}) { return { decision: "confirmed", reason: " Synthetic customer confirmation evidence ", ...overrides }; }
const deniedStates = [
  { name: "pending review", patch: { reviewStatus: "pending" }, error: /已批准/u },
  { name: "rejected review", patch: { reviewStatus: "rejected" }, error: /已批准/u },
  { name: "zero amount", patch: { approvedChargeAmount: 0 }, error: /金额大于/u },
  { name: "already confirmed", patch: { customerResponseStatus: "confirmed" }, error: /不能重复/u },
  { name: "repeat dispute", patch: { customerResponseStatus: "disputed" }, body: { decision: "disputed" }, error: /现有申诉/u }
];
module.exports = { row, request, deniedStates };
