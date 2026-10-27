/** Desktop business-view protocol. Carries display/navigation data, never credentials or business execution authority. */
export * from './agent-desktop-business';
import type { RentalDesktopCatalogQuery, RentalDesktopCatalogResult, RentalDesktopCatalogReply,
  RentalDesktopModelCatalogQuery, RentalDesktopModelCatalogResult, RentalDesktopBusinessReadRequest, RentalDesktopCatalogSourcesResult,
  RentalDesktopCatalogCheck, RentalDesktopCatalogCheckResult } from './agent-desktop-business';
export const RENTAL_DESKTOP_PROTOCOL_VERSION = 1 as const;

export interface RentalDesktopMenuItem { id: string; path: string; label: string }
export interface RentalDesktopMenuSection { id: string; label: string; items: RentalDesktopMenuItem[] }
export interface RentalDesktopWorkspace { id: string; name: string; categoryCode: string | null }
export type RentalDesktopSession =
  | { status: "unavailable" | "signed-out" | "password-change" }
  | {
      status: "ready";
      actorId: string;
      tenantId: string;
      tenantName: string;
      displayName: string;
      audience: "tenant" | "saas";
      currentWorkspaceId: string | null;
      workspaces: RentalDesktopWorkspace[];
      sections: RentalDesktopMenuSection[];
      defaultPath: string | null;
      pathname: string;
    };
export interface RentalDesktopSnapshot {
  protocolVersion: typeof RENTAL_DESKTOP_PROTOCOL_VERSION;
  revision: number;
  session: RentalDesktopSession;
}
export type RentalDesktopCommand =
  | { kind: "navigate"; revision: number; routeId: string }
  | { kind: "switch-workspace"; revision: number; workspaceId: string }
  | { kind: "logout" | "revalidate"; revision: number };
export interface RentalDesktopCommandRequest {
  id: string;
  command: RentalDesktopCommand;
  session: { actorId: string; tenantId: string; workspaceId: string | null } | null;
}
export interface RentalDesktopCommandResult { id: string; ok: boolean }
export interface RentalDesktopBounds { x: number; y: number; width: number; height: number }
export interface RentalDesktopBridge {
  protocolVersion: typeof RENTAL_DESKTOP_PROTOCOL_VERSION;
  read(): Promise<RentalDesktopSnapshot>;
  subscribe(listener: (snapshot: RentalDesktopSnapshot) => void): () => void;
  request(command: RentalDesktopCommand): Promise<void>;
  present(input: { mode: "ai" | "traditional"; bounds: RentalDesktopBounds | null }): Promise<void>;
  retry(): Promise<void>;
  /** Available only with the closed business bridge; does not grant model/session admission. */
  catalog?(query: RentalDesktopCatalogQuery): Promise<RentalDesktopCatalogResult>;
  /** Resolve a Host-owned prepared model route before and after the same human-only catalog read. */
  catalogForModel?(query: RentalDesktopModelCatalogQuery): Promise<RentalDesktopModelCatalogResult>;
  /** Current-authorized source references only; never old catalog bodies or automatic re-execution. */
  catalogSources?(query: { limit: number }): Promise<RentalDesktopCatalogSourcesResult>;
  /** Recheck current original permissions, policy/configuration and Host preparation; never extends the original observation lifetime. */
  checkCatalogForModel?(query: RentalDesktopCatalogCheck): Promise<RentalDesktopCatalogCheckResult>;
}
export interface RentalAdminDesktopBridge {
  protocolVersion: typeof RENTAL_DESKTOP_PROTOCOL_VERSION;
  report(session: RentalDesktopSession): Promise<void>;
  onCommand(listener: (request: RentalDesktopCommandRequest) => void): () => void;
  complete(result: RentalDesktopCommandResult): Promise<void>;
  onCatalog?(listener: (request: RentalDesktopBusinessReadRequest) => void): () => void;
  completeCatalog?(result: RentalDesktopCatalogReply): Promise<void>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop message");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unexpected desktop field");
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid desktop text");
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid desktop list");
  return value;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error("Duplicate desktop identity");
}
/** Validate a same-origin SPA pathname; no URL, query, hash, backslash or encoded path separators. */
export function rentalDesktopPath(value: unknown): string {
  const path = text(value, 2048);
  if (!path.startsWith("/") || path.startsWith("//") || /[\\?#]/u.test(path) || /%(?:2f|5c|00)/iu.test(path)
    || path.split("/").some(part => part === "." || part === "..")) throw new Error("Invalid desktop route");
  return path;
}
/** Decode the complete public projection, rejecting extra fields rather than forwarding secrets. */
export function parseRentalDesktopSession(value: unknown): RentalDesktopSession {
  const row = object(value);
  if (row.status === "unavailable" || row.status === "signed-out" || row.status === "password-change") {
    keys(row, ["status"]);
    return { status: row.status };
  }
  if (row.status !== "ready") throw new Error("Invalid desktop session");
  keys(row, ["status", "actorId", "tenantId", "tenantName", "displayName", "audience", "currentWorkspaceId", "workspaces", "sections", "defaultPath", "pathname"]);
  if (row.audience !== "tenant" && row.audience !== "saas") throw new Error("Invalid desktop audience");
  const workspaces = array(row.workspaces, 500).map(value => {
    const item = object(value); keys(item, ["id", "name", "categoryCode"]);
    return { id: text(item.id), name: text(item.name), categoryCode: item.categoryCode === null ? null : text(item.categoryCode) };
  });
  unique(workspaces.map(item => item.id));
  const sections = array(row.sections, 100).map(value => {
    const section = object(value); keys(section, ["id", "label", "items"]);
    return { id: text(section.id), label: text(section.label), items: array(section.items, 200).map(value => {
      const item = object(value); keys(item, ["id", "path", "label"]);
      return { id: text(item.id), path: rentalDesktopPath(item.path), label: text(item.label) };
    }) };
  });
  unique(sections.map(item => item.id)); unique(sections.flatMap(section => section.items.map(item => item.id)));
  const currentWorkspaceId = row.currentWorkspaceId === null ? null : text(row.currentWorkspaceId);
  if (currentWorkspaceId !== null && !workspaces.some(item => item.id === currentWorkspaceId)) throw new Error("Unknown desktop workspace");
  const defaultPath = row.defaultPath === null ? null : rentalDesktopPath(row.defaultPath);
  if (defaultPath !== null && !sections.some(section => section.items.some(item => item.path === defaultPath))) throw new Error("Unknown desktop default route");
  const result: RentalDesktopSession = { status: "ready", actorId: text(row.actorId), tenantId: text(row.tenantId), tenantName: text(row.tenantName),
    displayName: text(row.displayName), audience: row.audience, currentWorkspaceId, workspaces, sections, defaultPath,
    pathname: rentalDesktopPath(row.pathname) };
  // Bound the complete UTF-8 projection, not each field in isolation (names can contain multibyte text).
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 262_144) throw new Error("Desktop projection too large");
  return result;
}
/** Decode a current-session navigation command; no arbitrary paths or business actions are accepted. */
export function parseRentalDesktopCommand(value: unknown): RentalDesktopCommand {
  const row = object(value);
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw new Error("Invalid desktop revision");
  const revision = Number(row.revision);
  if (row.kind === "navigate") { keys(row, ["kind", "revision", "routeId"]); return { kind: row.kind, revision, routeId: text(row.routeId) }; }
  if (row.kind === "switch-workspace") { keys(row, ["kind", "revision", "workspaceId"]); return { kind: row.kind, revision, workspaceId: text(row.workspaceId) }; }
  if (row.kind === "logout" || row.kind === "revalidate") { keys(row, ["kind", "revision"]); return { kind: row.kind, revision }; }
  throw new Error("Unsupported desktop command");
}
/** Validate a finite native-view rectangle from the owned application renderer. */
export function parseRentalDesktopBounds(value: unknown): RentalDesktopBounds {
  const row = object(value); keys(row, ["x", "y", "width", "height"]);
  const result: RentalDesktopBounds = { x: 0, y: 0, width: 0, height: 0 };
  for (const key of ["x", "y", "width", "height"] as const) {
    const number = row[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100_000) throw new Error("Invalid desktop bounds");
    result[key] = Math.round(number);
  }
  return result;
}
