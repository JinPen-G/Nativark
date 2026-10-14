"use strict";
// One-off original-local-database procedure explicitly authorized in this chat.
// Does not alter or bypass the dedicated-clone tool's target guard.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { parseDatabaseUrl, buildDatabaseUrl, resolveDedicatedTarget, redact } = require(path.join(root, "scripts/ops/dedicated-env.cjs"));
const { assertContainerEndpoint, runMysql } = require(path.join(root, "scripts/ops/runtime.cjs"));
const { resolveRentalCategoryVersionBody } = require(path.join(root, "apps/api/dist/modules/rental-core/rental-category-resolver.service.js"));
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const actorId = "ops:local-authorized-20261008";
const reason = "用户明确授权修复本机原测试库；采用已在专用克隆库验证的运行版本，保留历史依据";
let db, clone, secrets = [];
async function preserved(client) {
  return {
    orders: digest(await client.rentalOrder.findMany({ orderBy: { id: "asc" } })),
    quotes: digest(await client.rentalQuote.findMany({ orderBy: { id: "asc" } })),
    legacy: digest(await client.rentalCategoryVersion.findMany({ where: { status: "legacy_baseline" }, orderBy: { id: "asc" } })),
  };
}
(async () => {
  try {
    if (process.argv[2] !== "--apply-authorized-local-original") throw new Error("Explicit apply flag required");
    const source = assertContainerEndpoint(parseDatabaseUrl(process.env.DATABASE_URL));
    if (source.database !== "rental_os" || !["localhost", "127.0.0.1"].includes(source.host)) throw new Error("Not the authorized local original database");
    if (process.env.NODE_ENV === "production") throw new Error("Production environment refused");
    secrets = [source.password];
    const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, "clone-evidence.json"), "utf8"));
    const result = JSON.parse(fs.readFileSync(path.join(__dirname, "reconcile.log"), "utf8"));
    if (result.result !== "passed" || evidence.source !== source.database || evidence.allBaseTableCountsMatched !== 201) throw new Error("Missing clone evidence");
    const cloneUrl = buildDatabaseUrl(process.env.DATABASE_URL, { user: source.user, password: source.password, database: evidence.database });
    resolveDedicatedTarget(cloneUrl);
    db = new PrismaClient(); clone = new PrismaClient({ datasources: { db: { url: cloneUrl } } });
    const expected = [];
    for (const runtime of RENTAL_CATEGORY_DEFINITIONS) {
      const versionId = `builtin:${runtime.code}:${digest(runtime).slice(0, 24)}`;
      const version = await clone.rentalCategoryVersion.findUnique({ where: { id: versionId } });
      const policy = await clone.rentalCategoryVersionPolicy.findUnique({ where: { versionId } });
      if (!version || !policy || version.status !== "published" || !isDeepStrictEqual(version.definition, JSON.parse(JSON.stringify(runtime)))) throw new Error("Unverified clone version: " + runtime.code);
      resolveRentalCategoryVersionBody(version, runtime.code);
      expected.push({ runtime, versionId, version, policy, code: runtime.code.toUpperCase(), legacyId: `legacy:${runtime.code}` });
    }
    // Full current-state export before original-local writes; ignored backups/ only.
    const dump = runMysql("mysqldump", source, ["--single-transaction", "--quick", "--routines", "--events", "--triggers", "--no-tablespaces", "--set-gtid-purged=OFF", "--databases", source.database], { capture: true });
    if (dump.status !== 0 || !dump.stdout?.length || !dump.stdout.toString("utf8").includes("Dump completed")) throw new Error("Backup failed: " + dump.stderr);
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const backup = path.join(root, "backups", `rental_os-before-local-category-reconcile-${stamp}.sql`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, dump.stdout, { flag: "wx" });
    fs.writeFileSync(backup + ".sha256", createHash("sha256").update(dump.stdout).digest("hex") + "\n", { flag: "wx" });
    console.log("Backup saved:", path.relative(root, backup));
    const before = await preserved(db);
    const changes = await db.$transaction(async (tx) => {
      const items = [];
      for (const e of expected.sort((a, b) => a.code.localeCompare(b.code))) {
        const category = await tx.rentalCategoryDefinition.findUnique({ where: { code: e.code } });
        if (!category || ![e.legacyId, e.versionId].includes(category.recommendedVersionId)) throw new Error("Unexpected current recommendation: " + e.code);
        const existing = await tx.rentalCategoryVersion.findUnique({ where: { id: e.versionId } });
        if (existing && (existing.status !== "published" || existing.categoryCode !== e.code || !isDeepStrictEqual(existing.definition, e.version.definition))) throw new Error("Existing version mismatch: " + e.code);
        if (!existing) {
          await tx.rentalCategoryVersion.create({ data: {
            id: e.versionId, categoryCode: e.code, versionLabel: e.version.versionLabel,
            structureVersion: e.version.structureVersion, sourceVersionId: e.legacyId,
            sourceKind: "builtin_runtime", status: "published", revision: 0,
            definition: e.version.definition, publishedAt: new Date(), publishedBy: actorId, publishReason: reason,
          } });
          await tx.rentalCategoryGovernanceAudit.create({ data: { categoryCode: e.code, versionId: e.versionId, action: "builtin_publish", actorId, reason } });
        }
        const policy = await tx.rentalCategoryVersionPolicy.findUnique({ where: { versionId: e.versionId } });
        if (!policy) {
          const { createScope, upgradeScope, restoreScope } = e.policy;
          if ([createScope, upgradeScope, restoreScope].some((x) => x !== "all")) throw new Error("Unexpected clone policy");
          await tx.rentalCategoryVersionPolicy.create({ data: { versionId: e.versionId, createScope, upgradeScope, restoreScope } });
        }
        if (category.recommendedVersionId === e.legacyId) {
          const changed = await tx.rentalCategoryDefinition.updateMany({ where: { code: e.code, recommendedVersionId: e.legacyId, openingRevision: category.openingRevision }, data: { recommendedVersionId: e.versionId, openingRevision: { increment: 1 } } });
          if (changed.count !== 1) throw new Error("Recommendation changed concurrently");
          await tx.rentalCategoryGovernanceAudit.create({ data: { categoryCode: e.code, versionId: e.versionId, action: "recommend_builtin", actorId, reason, before: { recommendedVersionId: e.legacyId, openingRevision: category.openingRevision }, after: { recommendedVersionId: e.versionId, openingRevision: category.openingRevision + 1 } } });
        }
        const spaces = await tx.businessWorkspace.findMany({ where: { categoryCode: e.code, categoryVersionId: e.legacyId }, orderBy: { id: "asc" }, select: { id: true, tenantId: true, categoryAdoptionRevision: true } });
        for (const space of spaces) {
          const changed = await tx.businessWorkspace.updateMany({ where: { id: space.id, tenantId: space.tenantId, categoryCode: e.code, categoryVersionId: e.legacyId, categoryAdoptionRevision: space.categoryAdoptionRevision }, data: { categoryVersionId: e.versionId, categoryAdoptionRevision: { increment: 1 } } });
          if (changed.count !== 1) throw new Error("Workspace changed concurrently");
          await tx.rentalCategoryAdoptionAudit.create({ data: { tenantId: space.tenantId, workspaceId: space.id, fromVersionId: e.legacyId, toVersionId: e.versionId, fromRevision: space.categoryAdoptionRevision, toRevision: space.categoryAdoptionRevision + 1, action: "runtime_reconcile", actorId, reason } });
        }
        items.push({ code: e.code, versionId: e.versionId, reboundWorkspaces: spaces.length });
      }
      if (!isDeepStrictEqual(before, await preserved(tx))) throw new Error("Historical orders, quotes or legacy versions changed");
      return items;
    }, { timeout: 30000 });
    const after = await preserved(db);
    if (!isDeepStrictEqual(before, after)) throw new Error("Post-commit historical verification failed");
    fs.writeFileSync(path.join(__dirname, "original-reconcile.json"), JSON.stringify({ result: "passed", database: source.database, backup: path.relative(root, backup), changes, preservedHashes: after }, null, 2));
    console.log(JSON.stringify({ result: "passed", database: source.database, changes, historyUnchanged: true }));
  } catch (error) {
    console.error(redact(error.message, secrets)); process.exitCode = 1;
  } finally { await db?.$disconnect(); await clone?.$disconnect(); }
})();
