/** Immutable settings-save evidence: tenant OperationLog or namespaced
 * scope-owned configuration receipt. One committed revision, not admission. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BudgetError, type BudgetSettingsOperation, type BudgetPolicyKey } from './budget.ports';

const code = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const budgetSettingsOperationSchema = z.object({ operationKey: code,
  action: z.enum(['change', 'initialize', 'refreshConfiguration']), commandHash: z.string().regex(/^[a-f0-9]{64}$/u),
  tenantId: code, workspaceId: code, actorId: code }).strict();
export const platformBudgetOperationSchema = z.object({ kind: z.literal('platform'), action: z.literal('platformSave'),
  operationKey: code, commandHash: z.string().regex(/^[a-f0-9]{64}$/u), actorId: code }).strict();
export const platformBudgetReceiptSchema = platformBudgetOperationSchema.extend({ version: z.literal('platform-budget-settings-save-1'),
  scopeId: code, scopeKind: z.literal('PLATFORM'), sceneCode: code, policyId: code,
  expectedRevision: z.number().int().min(0).max(4294967294), savedRevision: z.number().int().min(1).max(4294967295),
  settingsHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().refine(v => v.savedRevision === v.expectedRevision + 1);
/** Existing scope-owned configuration receipts, not tenant audit attribution.
 * Namespace exceeds the 36-character model Profile limit to avoid collisions;
 * with the 128-character scene it stays below the table's 191-character key. */
export const platformBudgetOperationTarget = (sceneCode: string) => `ai-native:platform-budget-settings:scene:${sceneCode}`;
export const platformBudgetOperationWhere = (key: BudgetPolicyKey, operationKey: string) => ({
  scopeId: key.scopeId, scopeKind: 'PLATFORM' as const, targetId: platformBudgetOperationTarget(key.sceneCode), operationKey });
export const budgetSettingsReceiptSchema = budgetSettingsOperationSchema.extend({
  version: z.literal('budget-settings-save-1'), scopeId: code, scopeKind: z.enum(['TENANT', 'WORKSPACE']), sceneCode: code,
  policyId: code, expectedRevision: z.number().int().min(0).max(4294967294),
  savedRevision: z.number().int().min(1).max(4294967295), settingsHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict().refine(v => v.savedRevision === v.expectedRevision + 1
  && (v.action === 'initialize' ? v.expectedRevision === 0 : v.expectedRevision > 0));
export function settingsOperationId(key: BudgetPolicyKey, operationKey: string) {
  return createHash('sha256').update(JSON.stringify(['budget-settings-save-1', key.scopeKind, key.scopeId, key.sceneCode, operationKey])).digest('hex');
}
export function checkedSettingsOperation(value: BudgetSettingsOperation): BudgetSettingsOperation {
  const result = (value.kind === 'platform' ? platformBudgetOperationSchema : budgetSettingsOperationSchema).safeParse(structuredClone(value));
  if (!result.success) throw new BudgetError('INVALID');
  return result.data;
}
