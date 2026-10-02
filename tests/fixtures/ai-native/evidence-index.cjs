"use strict";
// Evidence metadata only. Loading this fixture does not import or execute business tests.
const base = "docs/开发任务/附件/AI原生系统协作切片/";
const levels = ["static", "type_check", "unit", "contract", "real_database", "browser", "wechat_host", "real_device", "real_model", "external_payment", "production_canary"];
const commits = {
  S01: "a8cdd30742d0d17a5f36050e2726f984fa88a336",
  S02: "a9cd10c548ceb13325324f62011ca99a33f19cba",
  S03: "47e425b21009d831a18f29779f44ae1e34b4ce84",
  S04: "de52ea74c632e0120141558451694415ac0580a3"
};
const sources = [
  { id: "inventory", slice: "S01", path: "apps/api/src/modules/ai-native/tool-baseline.ts", anchor: "AI_TOOL_BASELINE", kind: "source" },
  { id: "inventory-tests", slice: "S01", path: "tests/ai-native-tool-baseline.test.cjs", anchor: "reuse candidates match actual decorated routes", kind: "test" },
  ...[ ["S02", "fact", "AIN-01-S02-20261002-codex.md"], ["S03", "authorization", "AIN-01-S03-20261002-codex.md"],
    ["S04", "history-context", "AIN-01-S04-20261003-codex.md"] ].flatMap(([slice, name, record]) => [
    { id: `${slice}-tests`, slice, path: `tests/ai-native-${name}-baseline.test.cjs`, kind: "test" },
    { id: `${slice}-inputs`, slice, path: `tests/fixtures/ai-native/${name}-baseline.cjs`, kind: "input" },
    { id: `${slice}-record`, slice, path: base + record, kind: "author_record" }
  ])
].map(source => ({ ...source, commit: commits[source.slice] }));
function row(id, family, entry, identities, scopes, permissionLayers, evidenceRefs, limitations, gap = false) {
  return { id, family, entry, identities, scopes, permissionLayers, aiAvailability: "unavailable",
    evidenceRefs, limitations, independentReview: "pending", currentRun: "index_structure_and_paths_only",
    evidence: levels.map(level => ({ level,
      status: level === "static" ? "prior_recorded" : level === "unit" && evidenceRefs.length ? (gap ? "prior_known_gap" : "prior_recorded") : "not_run",
      sources: level === "static" ? ["inventory", "inventory-tests"] : level === "unit" ? evidenceRefs.map(ref => ref.sourceId) : [],
      assertion: level === "static" ? "Engineering inventory only; no enabled AI handler" : level === "unit" && evidenceRefs.length
        ? "Historical author record and committed test source; NOT rerun in S05" : "No corresponding evidence claimed by this index" })) };
}
const ref = (sourceId, anchor) => ({ sourceId, anchor });
const tools = [
  ["rental.order.explain", "RentalCoreController.order", ["operator", "staff", "SaaS-denied"], ["tenant", "workspace", "own", "location"], ["audience", "route", "resource", "field"],
    [ref("S03-tests", "own and location scopes reach real Guard resource checks"), ref("S03-tests", "KNOWN BOUNDARY: normal order detail")], "Ordinary detail is not document finance clipping; no AI explanation chain"],
  ["rental.catalog.search", "RentalCoreController.groups", ["operator-planned"], ["tenant", "workspace", "location-planned"], ["route", "resource-planned", "field-planned"], [], "No catalog AI projection or bounded search acceptance"],
  ["rental.availability.check", "RentalCoreController.availability", ["operator-planned"], ["tenant", "workspace", "location-planned"], ["route", "resource-planned"], [], "No inventory reservation or concurrency evidence from availability inventory"],
  ["membership.customer.resolve", "RentalCoreController.bookingMembers; MembershipService.listPersonalOptions/listBookingOptions", ["operator"], ["tenant", "workspace", "own", "location"], ["route", "resource", "qualification"],
    [ref("S03-tests", "tenant member candidate does not imply current workspace booking qualification")], "Tenant candidates are not workspace eligibility; no AI candidate disambiguation"],
  ["rental.quote.preview", "RentalBusinessService.createQuote", ["synthetic-tenant"], ["workspace"], ["route-static", "pricing"],
    [ref("S02-tests", "quote persistence invocation writes only quote")], "Absorbing repository invocation, not real persistence/reservation; not HTTP authorization"],
  ["rental.order.propose", "not_implemented", ["operator-planned"], ["tenant", "workspace"], ["proposal", "approval"], [], "No proposal persistence or revision/hash implementation"],
  ["rental.order.commit", "RentalCoreController.createOrder; RentalOrderConfirmationService.createOrder", ["operator"], ["tenant", "workspace", "location"], ["route", "capability_exception", "actor", "idempotency"],
    [ref("S03-tests", "controller stamps actor fields"), ref("S03-tests", "actual application early replay")], "Early replay only; initial transaction, concurrent idempotency and notification delivery untested"],
  ["rental.change.preview", "RentalBusinessService.quoteOrderExtension/quotePostPickupExchange", ["synthetic-tenant"], ["workspace", "historical-context"], ["route-static", "pricing-source"],
    [ref("S04-tests", "complete saved context wins"), ref("S04-tests", "KNOWN GAP: absent saved context")], "S04 camera matrix, not all-category combinations; changed inputs can cause current fallback", true],
  ["tenant.opening.diagnose", "RentalBusinessService.tenantReadiness", ["synthetic-tenant"], ["workspace"], ["route-static", "configuration-field-planned"],
    [ref("S02-tests", "membership outage is unavailable"), ref("S02-tests", "KNOWN GAP: account dependency failure")], "Dependency failure has non-structured diagnostic path; no AI diagnosis or HTTP config-field acceptance", true],
  ["tenant.config.propose", "not_implemented", ["operator-planned"], ["workspace"], ["proposal", "field", "publish"], [], "No independent-section proposal/approval/publish execution"],
  ["membership.profile.propose", "not_implemented", ["operator-planned"], ["tenant"], ["proposal", "sensitive-field"], [], "No AI profile edits or identity verification"],
  ["inspection.draft.extract", "not_implemented", ["staff-planned"], ["workspace", "resource-planned"], ["attachment", "template", "field"], [], "No extraction, host/device or model acceptance"],
  ["operations.risks.list", "RentalCoreController.workbenchTodos", ["operator-planned"], ["workspace", "own-planned", "location-planned"], ["route", "per-domain-planned"], [], "Static inventory only; do not generalize order Guard tests to all todos domains"],
  ["platform.category.propose", "CategoryGovernanceController.create", ["SaaS-planned"], ["platform"], ["route", "governance-preview", "publish", "adoption"], [], "Preview-only business draft, AI unavailable; no production preview/publish/adoption acceptance"]
];
const rows = tools.map(([family, ...args], i) => row(`tool-${i + 1}`, family, ...args));
rows.push(
  row("fact-client-auth", "client.session", "ClientAuthService.authenticate; ApiAuthGuard.canActivate", ["client", "operator-denied"], ["tenant", "workspace", "session"], ["audience", "session", "membership"],
    [ref("S03-tests", "real client authentication binds resource session")], "Client authentication does not establish order ownership; rate-limit dependency is a substitute"),
  row("fact-document", "order.document", "RentalDocumentService.render/readSnapshot", ["operator"], ["tenant", "workspace", "order", "snapshot"], ["route", "finance-field", "resource"],
    [ref("S03-tests", "historical financial document remains forbidden")], "Controller/method tests and query shape, not real SQL resource filtering or ordinary order clipping"),
  row("fact-report", "report.inventory", "RentalWorkspaceReportRepository.getOperationReport", ["synthetic-tenant", "own-denied"], ["workspace"], ["data-scope", "metric-source"],
    [ref("S02-tests", "report returns current snapshot")], "Current snapshot, no historical utilization/profit assertion"),
  row("fact-refund", "payment.refund", "PaymentRuntimeService.applyProviderRefundOutcome", ["synthetic-tenant"], ["tenant", "workspace"], ["funding-source", "outcome"],
    [ref("S02-tests", "provider success with internal funding failure")], "Controlled funding dependency; no actual provider or ledger acceptance"),
  row("fact-ai-mock", "legacy.ai.connection", "PlatformService.testAiConnection", ["synthetic-tenant"], ["tenant"], ["model-source"],
    [ref("S02-tests", "legacy AI connection success is explicitly mock")], "mock_success is NOT real_model evidence"),
  row("fact-history", "historical.basis", "RentalBusinessService.quoteOrderExtension; RentalCoreService.listInspectionTemplates", ["synthetic-tenant"], ["workspace", "order-history"], ["historical-source"],
    [ref("S02-tests", "KNOWN GAP: legacy order without inspection snapshots"), ref("S04-tests", "KNOWN GAP: invalid historical timezone")], "Current inspection fallback and non-structured history errors; not repaired", true)
);
module.exports = { version: "evidence-index-draft-1", levels, commits, sources, rows,
  purpose: "metadata_index_only", review: "pending_independent_review", measuredBusinessMetrics: "not_collected" };
