"use strict";
module.exports = Object.freeze({
  scenario: { code: "camping.kit.availability", synthetic: true, actor: { kind: "staff", id: "synthetic_camping_staff" }, scope: { kind: "workspace", id: "synthetic_camping_workspace" }, inputRefs: ["synthetic_camping_kit", "synthetic_camping_window"], expected: "no_inventory" },
  kit: { id: "synthetic_camping_kit", persons: 4, season: "shoulder", equipment: ["synthetic-tent", "synthetic-stove", "synthetic-sleeping-bag"], cleanliness: "pending", damageCheck: "required" },
  branches: ["success", "no_inventory", "conflict", "cross_scope"]
});
