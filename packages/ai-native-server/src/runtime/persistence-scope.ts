import { z } from "zod";
import type { AiExecutionScope } from "@rental-os/shared";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const scopeSchema: z.ZodType<AiExecutionScope> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("platform") }).strict(),
  z.object({ kind: z.literal("tenant"), tenantId: id }).strict(),
  z.object({ kind: z.literal("workspace"), tenantId: id, workspaceId: id }).strict()
]);
export interface AiPersistenceScopeColumns {
  kind: "PLATFORM" | "TENANT" | "WORKSPACE";
  scopeKey: string;
  tenantId: string | null;
  workspaceId: string | null;
}

/** Storage normalization only, never authorization or default-workspace resolution. */
export function aiPersistenceScopeColumns(scope: AiExecutionScope): AiPersistenceScopeColumns {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new Error("AI_PERSISTENCE_SCOPE_INVALID");
  const value = parsed.data;
  if (value.kind === "platform") return { kind: "PLATFORM", scopeKey: "platform", tenantId: null, workspaceId: null };
  const tenant = `${value.tenantId.length}:${value.tenantId}`;
  if (value.kind === "tenant") return { kind: "TENANT", scopeKey: `tenant:${tenant}`, tenantId: value.tenantId, workspaceId: null };
  return { kind: "WORKSPACE", scopeKey: `workspace:${tenant}:${value.workspaceId.length}:${value.workspaceId}`, tenantId: value.tenantId, workspaceId: value.workspaceId };
}

/** Prisma exposes bigint cursors; request parsing never routes them through Number. */
export function aiPersistenceEventCursor(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) throw new Error("AI_EVENT_CURSOR_INVALID");
  const cursor = BigInt(value);
  if (cursor > 18446744073709551615n) throw new Error("AI_EVENT_CURSOR_INVALID");
  return cursor;
}
