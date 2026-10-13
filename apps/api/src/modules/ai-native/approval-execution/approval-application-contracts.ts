import Ajv, { type ValidateFunction } from 'ajv';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_SCHEMAS } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../../contracts/ai-native-schemas';
import { AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS } from '@rental-os/shared';
import type { AiApprovalApplicationReferenceDraft, AiApprovalApplicationDecisionDraft, AiApprovalApplicationReceiptDraft,
  AiApprovalApplicationReviewDraft, AiApprovalReprepareEligibilityRequestDraft, AiApprovalReprepareEligibilityDraft,
  AiApprovalReprepareCommandDraft, AiApprovalReprepareReceiptDraft, AiApprovalApplicationErrorDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';

type Contracts = {
  AiApprovalApplicationReferenceDraft: AiApprovalApplicationReferenceDraft;
  AiApprovalApplicationDecisionDraft: AiApprovalApplicationDecisionDraft;
  AiApprovalApplicationReceiptDraft: AiApprovalApplicationReceiptDraft;
  AiApprovalApplicationReviewDraft: AiApprovalApplicationReviewDraft;
  AiApprovalReprepareEligibilityRequestDraft: AiApprovalReprepareEligibilityRequestDraft;
  AiApprovalReprepareEligibilityDraft: AiApprovalReprepareEligibilityDraft;
  AiApprovalReprepareCommandDraft: AiApprovalReprepareCommandDraft;
  AiApprovalReprepareReceiptDraft: AiApprovalReprepareReceiptDraft;
  AiApprovalApplicationErrorDraft: AiApprovalApplicationErrorDraft;
};
const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
ajv.addFormat('date-time', value => z.string().datetime({ offset: true }).safeParse(value).success);
const definitions = JSON.parse(JSON.stringify({ AiPlatformScope: AI_NATIVE_COMPONENT_SCHEMAS.AiPlatformScope,
  AiTenantScope: AI_NATIVE_COMPONENT_SCHEMAS.AiTenantScope, AiWorkspaceScope: AI_NATIVE_COMPONENT_SCHEMAS.AiWorkspaceScope,
  ...AI_PROPOSAL_DRAFT_SCHEMAS, ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const validators = Object.fromEntries(Object.keys(AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS).map(name => [name,
  ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })])) as Record<keyof Contracts, ValidateFunction>;

export function approvalApplicationContract<K extends keyof Contracts>(name: K, value: unknown, output = false): Contracts[K] {
  const copy = structuredClone(value);
  if (!validators[name](copy)) throw new AiTaskRepositoryError(output ? 'AI_RESOURCE_UNAVAILABLE' : 'AI_INVALID_INPUT');
  return copy as Contracts[K];
}

export function approvalApplicationError(error: unknown): AiApprovalApplicationErrorDraft {
  const code = error instanceof Error && 'code' in error ? error.code : null;
  if (code === 'AI_RESULT_UNKNOWN') {
    const next = error instanceof Error && 'nextAction' in error ? error.nextAction : null;
    return { code: 'result_unknown', retryable: false, nextAction: next === 'read_decision_receipt' || next === 'read_reprepare_receipt' ? next : 'reconcile_original' };
  }
  if (code === 'AI_INVALID_INPUT') return { code: 'invalid_request', retryable: false, nextAction: 'correct_request' };
  if (code === 'AI_ACCESS_DENIED') return { code: 'access_denied', retryable: false, nextAction: 'reauthorize' };
  if (code === 'AI_REVISION_CONFLICT') return { code: 'revision_conflict', retryable: false, nextAction: 'reread_original' };
  return { code: 'unavailable', retryable: false, nextAction: 'manual' };
}
