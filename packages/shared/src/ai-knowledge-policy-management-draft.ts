export const AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION = 'knowledge-policy-management-1' as const;

export type AiKnowledgePolicyManagementAction = 'create_disabled' | 'update_disabled' | 'enable' | 'disable';
export type AiKnowledgePolicyChangeDraft = {
  version: typeof AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION;
  authorityId: string;
  operationKey: string;
  expectedRevision: number;
  action: AiKnowledgePolicyManagementAction;
  requiredPermissions: string[];
  expiresAt: string;
};
export type AiKnowledgePolicyCommitDraft = {
  preparationId: string;
  changeHash: string;
  confirm: 'apply_knowledge_policy_change';
};
export type AiKnowledgePolicyPreparationSelectionDraft = { operationKey: string; changeHash?: string };
export type AiKnowledgePolicyReceiptSelectionDraft = { operationKey: string; changeHash: string };
export type AiKnowledgePolicySnapshotDraft = {
  revision: number;
  enabled: boolean;
  requiredPermissions: string[];
  expiresAt: string;
};
export type AiKnowledgePolicyManagementReceiptDraft = {
  state: 'observed';
  operationKey: string;
  preparationId: string;
  changeHash: string;
  policyKeyHash: string;
  result: AiKnowledgePolicySnapshotDraft;
  recordedAt: string;
  retryable: false;
  executionPermission: false;
};
export type AiKnowledgePolicyManagementUnknownDraft = {
  state: 'unknown' | 'not_observed';
  operationKey: string;
  changeHash?: string;
  retryable: false;
  nextAction: 'read_preparation' | 'read_operation';
  executionPermission: false;
};
