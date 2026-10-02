const assert = require("node:assert/strict");
const fs = require("node:fs");
const { CategoryGovernancePreviewGuard } = require("../apps/api/dist/modules/rental-core/category-governance-preview.guard.js");
const { GUARDS_METADATA } = require("@nestjs/common/constants");
const { CategoryGovernanceController } = require("../apps/api/dist/modules/rental-core/category-governance.controller.js");
const { CategoryAdoptionPreparationController } = require("../apps/api/dist/modules/rental-core/category-adoption-preparation.controller.js");
const saved = { NODE_ENV: process.env.NODE_ENV, RENTAL_CATEGORY_GOVERNANCE_PREVIEW: process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW };
try {
  const guard = new CategoryGovernancePreviewGuard();
  for (const mode of [undefined, "test", "development", "production"]) {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
    for (const flag of [undefined, "false", "1", "TRUE", "true"]) {
      if (flag === undefined) delete process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW;
      else process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW = flag;
      if (mode !== "production" && flag === "true") assert.equal(guard.canActivate(), true);
      else assert.throws(() => guard.canActivate(), error => error.getStatus() === 404);
    }
  }
  for (const controller of [CategoryGovernanceController, CategoryAdoptionPreparationController]) {
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, controller).includes(CategoryGovernancePreviewGuard));
  }
  const read = p => fs.readFileSync(p, "utf8");
  assert.match(read("apps/admin/src/app/categoryGovernancePreview.ts"), /import\.meta\.env\.DEV && import\.meta\.env\.VITE_RENTAL_CATEGORY_GOVERNANCE_PREVIEW === "true"/);
  const routes = read("apps/admin/src/app/AppRouter.tsx");
  for (const key of ["platformCategories", "platformCategoryCapabilities"]) {
    assert.match(routes, new RegExp(`CATEGORY_GOVERNANCE_PREVIEW_ENABLED && <Route path=\\{APP_ROUTES\\.${key}`));
    assert.match(read("apps/admin/src/app/navigation.tsx"), new RegExp(`${key}: \\{[^\\n]+menu: CATEGORY_GOVERNANCE_PREVIEW_ENABLED`));
  }
  assert.match(read("apps/admin/src/features/settings/governance/CategoryPreparationDialog.tsx"), /return CATEGORY_GOVERNANCE_PREVIEW_ENABLED && workspaceId && hasPermission/);
  console.log("PASS preview gate: default closed, production closed, explicit nonproduction only; controller/menu/route/preparation gates retained");
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
