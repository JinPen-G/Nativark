/** 宿主审定的原历史/善后处理器票据。仅选择原动作与原对象；不授予用户权限，
 * 不从请求字段接受“善后”声明，不把订阅新业务分类的反集当成 Core 停用许可。 */
import { CoreAccessError } from "@rental-os/core-host";
import { normalizeRequestPath } from "@rental-os/platform-server/request-path";

export type RentalRecoveryKind = "history" | "fulfillment" | "settlement" | "payment-result";
export interface RentalRecoveryDeclaration {
  readonly method: string;
  readonly path: string;
  readonly kind: RentalRecoveryKind;
  readonly collection: boolean;
}
export interface RentalRecoverySubject {
  readonly declaration: RentalRecoveryDeclaration;
  readonly orderId?: string;
  readonly intentId?: string;
  readonly refundId?: string;
}
const declarations = new WeakSet<RentalRecoveryDeclaration>();
const denied = () => new CoreAccessError("denied", "Rental 历史或善后入口未绑定本处理器的原对象");

/** Private package composition input. The HTTP compiler calls this only for its
 * closed map of actual original controller functions, never arbitrary declarations. */
export function declareRentalRecovery(method: string, path: string, kind: RentalRecoveryKind): RentalRecoveryDeclaration {
  const collection = path === "/rental/v1/orders" || path === "/client/v1/orders" || path === "/client/v1/my/orders";
  if (!/^(?:GET|POST)$/u.test(method) || !/^(?:history|fulfillment|settlement|payment-result)$/u.test(kind)
    || collection && (kind !== "history" || method !== "GET")
    || !collection && !/^\/(?:rental|client)\/v1\/orders\/:(?:id|orderid)(?:\/|$)/u.test(path)) throw denied();
  const declaration = Object.freeze({ method, path, kind, collection });
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
  if (!declaration.collection && !orderId) throw denied();
  return Object.freeze({ declaration, orderId, intentId: parameters.get("intentid"), refundId: parameters.get("refundid") });
}
