import Ajv, { type ValidateFunction } from 'ajv';
import { z } from 'zod';
import { HttpException } from '@nestjs/common';
import { AI_TOOL_CODES, AI_PROPOSAL_DRAFT_SCHEMAS } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../../contracts/ai-native-schemas';
import { AI_APPROVED_SETTINGS_DRAFT_SCHEMAS } from '@rental-os/shared';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE, type AiApprovedSettingsPrepareDraft,
  type AiApprovedSettingsReferenceDraft, type AiApprovedSettingsDecisionDraft, type AiApprovedSettingsCommitDraft,
  type AiApprovedSettingsReadOperationDraft, type AiApprovedSettingsPayloadDraft, type AiApprovedSettingsReviewDraft,
  type AiApprovedSettingsChangeReviewDraft, type AiApprovedSettingsOperationReceiptDraft, type AiApprovedSettingsOperationResultDraft,
  type AiApprovedSettingsDecisionReceiptDraft, type AiApprovedSettingsPreparationReceiptDraft, type AiApprovedSettingsErrorDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';

type Contracts = {
  AiApprovedSettingsPrepareDraft: AiApprovedSettingsPrepareDraft;
  AiApprovedSettingsReferenceDraft: AiApprovedSettingsReferenceDraft;
  AiApprovedSettingsDecisionDraft: AiApprovedSettingsDecisionDraft;
  AiApprovedSettingsCommitDraft: AiApprovedSettingsCommitDraft;
  AiApprovedSettingsReadOperationDraft: AiApprovedSettingsReadOperationDraft;
  AiApprovedSettingsPayloadDraft: AiApprovedSettingsPayloadDraft;
  AiApprovedSettingsReviewDraft: AiApprovedSettingsReviewDraft;
  AiApprovedSettingsChangeReviewDraft: AiApprovedSettingsChangeReviewDraft;
  AiApprovedSettingsOperationReceiptDraft: AiApprovedSettingsOperationReceiptDraft;
  AiApprovedSettingsOperationResultDraft: AiApprovedSettingsOperationResultDraft;
  AiApprovedSettingsDecisionReceiptDraft: AiApprovedSettingsDecisionReceiptDraft;
  AiApprovedSettingsPreparationReceiptDraft: AiApprovedSettingsPreparationReceiptDraft;
  AiApprovedSettingsErrorDraft: AiApprovedSettingsErrorDraft;
};
const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
ajv.addFormat('date-time', value => z.string().datetime({ offset: true }).safeParse(value).success);
const definitions = JSON.parse(JSON.stringify({ AiPlatformScope: AI_NATIVE_COMPONENT_SCHEMAS.AiPlatformScope,
  AiTenantScope: AI_NATIVE_COMPONENT_SCHEMAS.AiTenantScope, AiWorkspaceScope: AI_NATIVE_COMPONENT_SCHEMAS.AiWorkspaceScope,
  ...AI_PROPOSAL_DRAFT_SCHEMAS, ...AI_APPROVED_SETTINGS_DRAFT_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const validators = Object.fromEntries(Object.keys(AI_APPROVED_SETTINGS_DRAFT_SCHEMAS).map(name => [name,
  ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })])) as Record<keyof Contracts, ValidateFunction>;
export function settingsContract<K extends keyof Contracts>(name: K, value: unknown, output = false): Contracts[K] {
  const copy = structuredClone(value);
  if (!validators[name](copy)) throw new AiTaskRepositoryError(output ? 'AI_RESOURCE_UNAVAILABLE' : 'AI_INVALID_INPUT');
  return copy as Contracts[K];
}
export function registeredSettingsTool() {
  const code = AI_TOOL_CODES.find((value: string) => value === AI_APPROVED_SETTINGS_TOOL_CODE);
  if (!code) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return code;
}
export class ApprovedSettingsApplicationUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  constructor(readonly nextAction: 'read_preparation_receipt' | 'read_decision_receipt') { super('AI_RESULT_UNKNOWN'); }
}
export function settingsApplicationError(error: unknown): AiApprovedSettingsErrorDraft {
  const raw = error instanceof Error && 'code' in error ? error.code : null;
  const status = error instanceof HttpException ? error.getStatus() : null;
  const code = raw === 'SETTINGS_RESULT_UNKNOWN' || raw === 'AI_RESULT_UNKNOWN' || raw === 'AI_INVALID_INPUT' || raw === 'AI_ACCESS_DENIED' || raw === 'AI_REVISION_CONFLICT'
    ? raw : status === 400 ? 'AI_INVALID_INPUT' : status === 401 || status === 403 ? 'AI_ACCESS_DENIED' : status === 409 ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE';
  const next = error instanceof Error && 'nextAction' in error ? error.nextAction : null;
  return { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, code, retryable: false,
    nextAction: code === 'SETTINGS_RESULT_UNKNOWN' ? 'read_operation' : code === 'AI_RESULT_UNKNOWN'
      ? next === 'read_decision_receipt' ? next : 'read_preparation_receipt' : 'revalidate_or_manual' };
}
