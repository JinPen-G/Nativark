/**
 * AIN-01 engineering inventory, NOT an executable tool registry or authorization.
 * Existing HTTP guards and controller checks cannot be bypassed by calling services.
 * Keep every AI adapter unavailable until AIN-02/04 and its scenario are verified.
 */
export type AiBaselineRisk = "R0" | "R1" | "R2" | "R3";
export type AiBaselineMaturity = "unavailable" | "preview_only" | "executable";
export interface AiBusinessEntry {
  readonly method: "GET" | "POST";
  /** Guard paths exclude the global /api prefix; :id denotes a resource identifier. */
  readonly path: string;
  readonly controllerFile: string;
  readonly controllerMethod: string;
  readonly permissionAnyOf: readonly string[];
}
export interface AiToolBaseline {
  readonly code: string;
  readonly version: "baseline-1";
  readonly scope: "platform" | "tenant" | "workspace";
  readonly risk: AiBaselineRisk;
  readonly aiMaturity: AiBaselineMaturity;
  readonly businessMaturity: "implemented" | "preview_only" | "not_implemented";
  readonly entry?: AiBusinessEntry;
  readonly sideEffects: readonly string[];
  readonly blockers: readonly string[];
}

const core = "apps/api/src/modules/rental-core/rental-core.controller.ts";
const business = "apps/api/src/modules/rental-core/rental-business.controller.ts";
const governance = "apps/api/src/modules/rental-core/category-governance.controller.ts";
const entry = (method: AiBusinessEntry["method"], path: string, controllerFile: string,
  controllerMethod: string, permissionAnyOf: string[]): AiBusinessEntry =>
  Object.freeze({ method, path, controllerFile, controllerMethod, permissionAnyOf: Object.freeze(permissionAnyOf) });
const readOrder = ["rental-os:order:view"];
const createOrder = ["rental-os:order:operate", "rental-os:order:create"];

// permissionAnyOf documents the legacy HTTP gate only, not all resource/field checks.
// scope documents the proposed AI operation, not permission to reuse all HTTP payloads.
const rows: Omit<AiToolBaseline, "version" | "aiMaturity">[] = [
  {
    code: "rental.order.explain", scope: "workspace", risk: "R0", businessMaturity: "implemented",
    entry: entry("GET", "/rental/v1/orders/:id", core, "order", readOrder), sideEffects: [],
    blockers: ["AIN-04 resource and field authorization", "AIN-08 minimal fact projection", "AIN-13 evidence-backed explanation"]
  },
  {
    code: "rental.catalog.search", scope: "workspace", risk: "R0", businessMaturity: "implemented",
    entry: entry("GET", "/rental/v1/item-groups", core, "groups", ["rental-core:catalog:view", "rental-core:catalog:manage", "rental-os:order:view", "rental-os:order:create"]),
    sideEffects: [], blockers: ["AIN-04 scope authorization", "AIN-08 bounded search and projection"]
  },
  {
    code: "rental.availability.check", scope: "workspace", risk: "R0", businessMaturity: "implemented",
    entry: entry("POST", "/rental/v1/availability", core, "availability", createOrder), sideEffects: [],
    blockers: ["AIN-04 scope authorization", "AIN-09 category-aware input validation; availability is not reservation"]
  },
  {
    code: "membership.customer.resolve", scope: "tenant", risk: "R0", businessMaturity: "implemented",
    entry: entry("GET", "/rental/v1/booking-members", core, "bookingMembers", ["rental-os:order:create"]), sideEffects: [],
    blockers: ["AIN-04 shared-member versus workspace booking eligibility", "AIN-08 masked bounded candidates; never select first match"]
  },
  {
    code: "rental.quote.preview", scope: "workspace", risk: "R1", businessMaturity: "implemented",
    entry: entry("POST", "/rental/v1/quotes", business, "quote", createOrder),
    sideEffects: ["Persists a formal quote snapshot; does not reserve inventory"],
    blockers: ["AIN-04 controller-equivalent authorization", "AIN-09 canonical Core pricing and declared quote persistence"]
  },
  {
    code: "rental.order.propose", scope: "workspace", risk: "R1", businessMaturity: "not_implemented",
    sideEffects: ["Persists an AI proposal, not an order"], blockers: ["AIN-03 proposal persistence", "AIN-07 revision and confirmation"]
  },
  {
    code: "rental.order.commit", scope: "workspace", risk: "R2", businessMaturity: "implemented",
    entry: entry("POST", "/rental/v1/orders", core, "createOrder", createOrder),
    sideEffects: ["Creates order and business inventory claims", "May queue order notification on first creation"],
    blockers: ["AIN-04 capability-exception permission and actor attribution", "AIN-07 approval and business idempotency", "AIN-15 result recovery"]
  },
  {
    code: "rental.change.preview", scope: "workspace", risk: "R0", businessMaturity: "implemented",
    entry: entry("POST", "/rental/v1/orders/:id/extensions/preview", core, "previewExtension", ["rental-os:order:extend", "rental-os:order:operate"]),
    sideEffects: [], blockers: ["AIN-04 resource authorization", "AIN-08/09 renewal projection; exchange and cancellation need separate mappings"]
  },
  {
    code: "tenant.opening.diagnose", scope: "workspace", risk: "R0", businessMaturity: "implemented",
    entry: entry("GET", "/rental/v1/tenant-readiness", core, "tenantReadiness", ["rental-os:order:view", "rental-os:price:manage", "system:user:manage", "system:role:manage"]),
    sideEffects: [], blockers: ["AIN-04 configuration field authorization", "AIN-14 required versus optional diagnosis"]
  },
  {
    code: "tenant.config.propose", scope: "workspace", risk: "R1", businessMaturity: "not_implemented",
    sideEffects: ["Persists an AI proposal; active settings remain unchanged"], blockers: ["AIN-03 proposal persistence", "AIN-14/16 per-section change whitelist"]
  },
  {
    code: "tenant.notifications.commit", scope: "workspace", risk: "R2", businessMaturity: "implemented",
    sideEffects: ["Updates only approved notification event/channel arrays and persists the original operation receipt"],
    blockers: ["AIN-04 current settings action authorization", "AIN-07 exact human approval and atomic consumption", "AIN-16 authorized settings step and explicit host wiring"]
  },
  {
    code: "membership.profile.propose", scope: "tenant", risk: "R1", businessMaturity: "not_implemented",
    sideEffects: ["Persists an AI proposal; sensitive identity verification remains human-controlled"], blockers: ["AIN-03 proposal persistence", "AIN-16 profile field whitelist"]
  },
  {
    code: "inspection.draft.extract", scope: "workspace", risk: "R1", businessMaturity: "not_implemented",
    sideEffects: ["Persists candidates and attachment references, not final inspection facts"], blockers: ["AIN-05 provider decision", "AIN-19 frozen template and resource-bound source extraction"]
  },
  {
    code: "operations.risks.list", scope: "workspace", risk: "R0", businessMaturity: "implemented",
    entry: entry("GET", "/rental/v1/workbench/todos", core, "workbenchTodos", ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"]),
    sideEffects: [], blockers: ["AIN-04 per-domain data and location authorization", "AIN-08 bounded evidence projection"]
  },
  {
    code: "platform.category.propose", scope: "platform", risk: "R1", businessMaturity: "preview_only",
    entry: entry("POST", "/platform/rental-categories/:code/drafts", governance, "create", ["system:rental-category:edit"]),
    sideEffects: ["Business preview can persist a draft; publishing and adoption are separate R3 actions"],
    blockers: ["CAT-GOV formal governance unavailable; production preview always closed", "AIN-07/23 proposal versus draft distinction"]
  }
];
const baseline: AiToolBaseline[] = rows.map(row => Object.freeze({ ...row, version: "baseline-1" as const, aiMaturity: "unavailable" as const,
  sideEffects: Object.freeze(row.sideEffects), blockers: Object.freeze(row.blockers) }));

/** Immutable development inventory. It deliberately contains NO dispatch handlers. */
export const AI_TOOL_BASELINE: readonly AiToolBaseline[] = Object.freeze(baseline);
