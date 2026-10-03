"use strict";
// Inputs only. Status transitions and failure classification remain production methods.
const { refundRow } = require("./fact-baseline.cjs");
const protectedStates = ["succeeded", "funding_pending"];
function row(overrides = {}) { return refundRow(overrides); }
function outcome(status, overrides = {}) {
  return { status, externalStatus: status.toUpperCase(), externalRefundId: "external-a", responseJson: { synthetic: true }, ...overrides };
}
const failures = [
  { message: "connection reset", definitive: false },
  { message: "HTTP 503: upstream unavailable", definitive: false },
  { message: "HTTP 409: frequency limited", definitive: false },
  { message: "HTTP 400: invalid request", definitive: true },
  { message: "HTTP 401: unauthorized", definitive: true }
];
module.exports = { row, outcome, protectedStates, failures };
