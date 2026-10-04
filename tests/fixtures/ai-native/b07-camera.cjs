"use strict";
module.exports = Object.freeze({
  scenario: { code: "camera.equipment.group", synthetic: true, actor: { kind: "operator", id: "synthetic_camera_operator" }, scope: { kind: "workspace", id: "synthetic_camera_workspace" }, inputRefs: ["synthetic_camera_group", "synthetic_camera_asset"], expected: "missing_evidence" },
  equipmentGroup: { id: "synthetic_camera_group", body: "synthetic-camera-body", lensMount: "synthetic-mount", sensor: "full_frame", lightKit: ["synthetic-light-1"], serial: "synthetic-serial-1", condition: "needs_inspection" },
  branches: ["success", "missing_evidence", "cross_scope"]
});
