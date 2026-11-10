/** Original bounded catalog input and result types, shared by API and adapters.
 * Validation is not authorization, MCP publication or external field release.
 * Core facts, current scope and persisted configuration evidence remain owner-run. */
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import type { AiExecutionContext } from './ai-native';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
/** Original Core/API query: the MCP-specific 50-row cap stays in its authority. */
export const aiCatalogReadInputSchema = z.object({ limit: z.number().int().min(1).max(100),
  cursor: id.optional(), itemGroupId: id.optional(), name: z.string().trim().min(1).max(191).optional() }).strict();

/** Existing original projection; not a grant to release all fields to a Host. */
export interface AiCatalogReadProjection {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
  audience: AiExecutionContext['audience'];
  scope: AiExecutionContext['scope'];
  observedAt: string;
  items: Array<{ id: string; code: string; name: string; categoryCode: string; status: 'enabled' | 'disabled'; unit: string }>;
  truncated: boolean;
  nextCursor: string | null;
  configurationVersion: string;
  source: 'persisted_workspace_configuration';
}

const projectedItem = z.object({ id, code: id, name: z.string().min(1).max(191),
  categoryCode: z.string().min(1).max(64), status: z.enum(['enabled', 'disabled']),
  unit: z.string().min(1).max(32) }).strict();
const observation = z.string().max(32).refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, 'Invalid original catalog observation');

/** Runtime shape of the original bounded reader's projection, not a release
 * policy or MCP wire schema. The reader still proves query/scope/configuration
 * binding; this checks its closed fields and page consistency for consumers.
 * Keep the original 100-row API bound, independently of MCP's 50-row authority. */
export const aiCatalogReadProjectionSchema = z.object({
  contractVersion: z.literal(AI_CONTRACT_DRAFT_VERSION),
  requestId: z.string(), audience: z.enum(['operator', 'staff']),
  scope: z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
  observedAt: observation, items: z.array(projectedItem).max(100),
  truncated: z.boolean(), nextCursor: id.nullable(),
  configurationVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  source: z.literal('persisted_workspace_configuration'),
}).strict().superRefine((value, context) => {
  const ids = value.items.map(item => item.id), codes = value.items.map(item => item.code);
  if (new Set(ids).size !== ids.length || new Set(codes).size !== codes.length
    || ids.some((itemId, index) => index > 0 && itemId <= ids[index - 1])
    || (value.truncated ? !ids.length || value.nextCursor !== ids.at(-1) : value.nextCursor !== null)) {
    context.addIssue({ code: 'custom', message: 'Invalid original catalog page' });
  }
}) satisfies z.ZodType<AiCatalogReadProjection>;
