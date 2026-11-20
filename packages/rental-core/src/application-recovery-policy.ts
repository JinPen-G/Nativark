/** 宿主审定的原历史/善后处理器票据。仅选择原动作与原对象；不授予用户权限，
 * 不从请求字段接受“善后”声明，不把订阅新业务分类的反集当成 Core 停用许可。 */
import { CoreAccessError } from "@rental-os/core-host";
import { normalizeRequestPath } from "@rental-os/platform-server/request-path";
import type { EnterprisePortalAction } from "./enterprise";

export type RentalRecoveryKind = "history" | "fulfillment" | "settlement" | "payment-result";
export interface RentalRecoveryDeclaration {
  readonly method: string;
  readonly path: string;
  readonly kind: RentalRecoveryKind;
  readonly collection: boolean;
  readonly scope: "order" | "order-collection" | "workspace-history" | "corporate-history";
  readonly corporateActions?: readonly EnterprisePortalAction[];
}
export interface RentalRecoverySubject {
  readonly declaration: RentalRecoveryDeclaration;
  readonly orderId?: string;
  readonly intentId?: string;
  readonly refundId?: string;
  readonly corporateId?: string;
}
const declarations = new WeakSet<RentalRecoveryDeclaration>();
const denied = () => new CoreAccessError("denied", "Rental 历史或善后入口未绑定本处理器的原对象");
// These customer routes still read the caller's own original order. Enterprise
// administrator projections and preparation/approval commands are separate powers.
const ownEnterpriseHistory = new Set([
  "/client/v1/enterprise/orders/:orderid/exchange-inspection-consents/operations/:key",
  "/client/v1/enterprise/orders/:orderid/exchange-approvals"
]);
// Reports and statement batches contain workspace facts, including unmatched
// statement lines. They cannot invent an order binding or authorize a command.
const workspaceHistory = new Set([
  "/rental/v1/reports/operations",
  "/rental/v1/reports/operations/export",
  "/rental/v1/payment-reconciliation/statements",
  "/rental/v1/payment-reconciliation/statements/:batchid"
]);
// These eight existing readers retain their dedicated enterprise authority and
// original projections. Neither administrator status nor client-own order scope
// can replace these exact actions; membership management/new use is not included.
const corporatePrefix = "/client/v1/enterprise/corporates/:corporateid";
const corporateHistory = new Map<string, readonly EnterprisePortalAction[]>([
  [`${corporatePrefix}/history-workspaces`, ["orders:read"]],
  [`${corporatePrefix}/orders`, ["orders:read"]],
  [`${corporatePrefix}/orders/:orderid`, ["orders:read"]],
  [`${corporatePrefix}/orders/export-rows`, ["orders:read", "export:create"]],
  [`${corporatePrefix}/finance`, ["finance:read"]],
  [`${corporatePrefix}/finance/export-rows`, ["finance:read", "export:create"]],
  [`${corporatePrefix}/orders/:orderid/finance`, ["orders:read", "finance:read"]],
  [`${corporatePrefix}/orders/:orderid/finance/export-rows`, ["orders:read", "finance:read", "export:create"]]
]);

/** Private package composition input. The HTTP compiler calls this only for its
 * closed map of actual original controller functions, never arbitrary declarations. */
export function declareRentalRecovery(method: string, path: string, kind: RentalRecoveryKind): RentalRecoveryDeclaration {
  const collection = path === "/rental/v1/orders" || path === "/client/v1/orders" || path === "/client/v1/my/orders";
  const workspace = workspaceHistory.has(path), enterprise = ownEnterpriseHistory.has(path);
  const corporateActions = corporateHistory.get(path);
  if (!/^(?:GET|POST)$/u.test(method) || !/^(?:history|fulfillment|settlement|payment-result)$/u.test(kind)
    || (collection || workspace || enterprise || corporateActions) && (kind !== "history" || method !== "GET")
    || !collection && !workspace && !enterprise && !corporateActions && !/^\/(?:rental|client)\/v1\/orders\/:(?:id|orderid)(?:\/|$)/u.test(path)) throw denied();
  const scope = corporateActions ? "corporate-history" : workspace ? "workspace-history" : collection ? "order-collection" : "order";
  const declaration = Object.freeze({ method, path, kind, collection, scope,
    ...(corporateActions ? { corporateActions: Object.freeze([...corporateActions]) } : {}) });
  declarations.add(declaration);
  return declaration;
}

export function bindRentalRecovery(declaration: RentalRecoveryDeclaration,
  request: { method: string; url: string }): RentalRecoverySubject {
  if (!declarations.has(declaration) || request.method.toUpperCase() !== declaration.method
    && !(request.method.toUpperCase() === "HEAD" && declaration.method === "GET")) throw denied();
  const actual = normalizeRequestPath(request.url).split("/"), expected = declaration.path.split("/");
  if (actual.length !== expected.length) throw denied();
  const parameters = new Map<string, string>();
  for (let index = 0; index < expected.length; index++) {
    const segment = expected[index];
    if (!segment.startsWith(":")) { if (actual[index].toLowerCase() !== segment) throw denied(); continue; }
    let value: string;
    try { value = decodeURIComponent(actual[index]); } catch { throw denied(); }
    if (!value || /[\/\\\u0000-\u001f]/u.test(value)) throw denied();
    parameters.set(segment.slice(1), value);
  }
  if (parameters.has("stage") && !["pickup", "return"].includes(parameters.get("stage")!)) throw denied();
  const orderId = parameters.get("id") ?? parameters.get("orderid");
  const corporateId = parameters.get("corporateid");
  const requiresOrder = declaration.scope === "order"
    || declaration.scope === "corporate-history" && declaration.path.includes("/:orderid");
  if (requiresOrder !== Boolean(orderId) || (declaration.scope === "corporate-history") !== Boolean(corporateId)) throw denied();
  return Object.freeze({ declaration, orderId, intentId: parameters.get("intentid"), refundId: parameters.get("refundid"), corporateId });
}
