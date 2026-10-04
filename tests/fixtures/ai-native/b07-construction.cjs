"use strict";
module.exports = Object.freeze({
  scenario: { code: "construction.machine.delivery", synthetic: true, actor: { kind: "staff", id: "synthetic_construction_staff" }, scope: { kind: "workspace", id: "synthetic_construction_workspace" }, inputRefs: ["synthetic_machine", "synthetic_site"], expected: "missing_evidence" },
  machine: { id: "synthetic_machine", manufacturer: "synthetic-maker", model: "synthetic-model", serial: "synthetic-serial", hourMeter: 321, ratedCapacity: "synthetic-2t", operatorQualification: "synthetic-qualification", inspectionExpires: "synthetic-2027-01-01", delivery: "field_site" },
  branches: ["success", "missing_evidence", "forbidden", "cross_scope"]
});
