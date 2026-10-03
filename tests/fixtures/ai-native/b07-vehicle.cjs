"use strict";
module.exports = Object.freeze({
  scenario: { code: "vehicle.return.inspection", synthetic: true, actor: { kind: "operator", id: "synthetic_vehicle_operator" }, scope: { kind: "workspace", id: "synthetic_vehicle_workspace" }, inputRefs: ["synthetic_vehicle_asset", "synthetic_vehicle_return"], expected: "missing_evidence" },
  vehicle: { id: "synthetic_vehicle_asset", vin: "synthetic-vin-0001", plate: "synthetic-plate", mileageKm: 12345, fuelLevel: "half", driverCredential: "synthetic-license", returnInspection: "required" },
  branches: ["success", "missing_evidence", "forbidden", "cross_scope"]
});
