-- Align existing AI foreign-key names/actions and insertion defaults with the
-- current Prisma contract. Each same-column FK replacement is one ALTER so no
-- enforcement gap is committed. No rows, columns or scope CHECKs are removed.
-- Legacy owner values remain unchanged; new writes must supply their real owner.

ALTER TABLE `ai_budget_allocations` DROP FOREIGN KEY `ai_budget_allocations_policy_fk`,
  ADD CONSTRAINT `ai_budget_allocations_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `ai_budget_policies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_budget_allocations` DROP FOREIGN KEY `ai_budget_allocations_reservation_fk`,
  ADD CONSTRAINT `ai_budget_allocations_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `ai_budget_reservations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_budget_ledger_entries` DROP FOREIGN KEY `ai_budget_ledger_entries_reservation_fk`,
  ADD CONSTRAINT `ai_budget_ledger_entries_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `ai_budget_reservations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_budget_policies` DROP FOREIGN KEY `ai_budget_policies_scope_fk`,
  ADD CONSTRAINT `ai_budget_policies_scopeId_scopeKind_fkey` FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts` DROP FOREIGN KEY `ai_gateway_accounting_admission_fk`,
  ADD CONSTRAINT `ai_gateway_accounting_receipts_tenantId_workspaceId_admissi_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `admissionId`) REFERENCES `ai_invocation_admissions`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts` DROP FOREIGN KEY `ai_gateway_accounting_invocation_fk`,
  ADD CONSTRAINT `ai_gateway_accounting_receipts_scopeId_taskId_invocationId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `invocationId`) REFERENCES `ai_gateway_invocations`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts` DROP FOREIGN KEY `ai_gateway_accounting_reservation_fk`,
  ADD CONSTRAINT `ai_gateway_accounting_receipts_scopeId_scopeKind_reservatio_fkey` FOREIGN KEY (`scopeId`, `scopeKind`, `reservationId`) REFERENCES `ai_budget_reservations`(`scopeId`, `scopeKind`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_invocations` DROP FOREIGN KEY `ai_gateway_invocations_run_fk`,
  ADD CONSTRAINT `ai_gateway_invocations_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_invocations` DROP FOREIGN KEY `ai_gateway_invocations_step_fk`,
  ADD CONSTRAINT `ai_gateway_invocations_scopeId_taskId_actionId_stepFingerpr_fkey` FOREIGN KEY (`scopeId`, `taskId`, `actionId`, `stepFingerprint`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_acl` DROP FOREIGN KEY `ai_knowledge_acl_document_fk`,
  ADD CONSTRAINT `ai_knowledge_acl_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_chunks` DROP FOREIGN KEY `ai_knowledge_chunks_version_fk`,
  ADD CONSTRAINT `ai_knowledge_chunks_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `ai_knowledge_versions`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_operations` DROP FOREIGN KEY `ai_knowledge_operations_document_fk`,
  ADD CONSTRAINT `ai_knowledge_operations_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_versions` DROP FOREIGN KEY `ai_knowledge_versions_document_fk`,
  ADD CONSTRAINT `ai_knowledge_versions_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_platform_model_connections` DROP FOREIGN KEY `ai_platform_model_connections_profile_fk`,
  ADD CONSTRAINT `ai_platform_model_connections_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ai_provider_profiles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_provider_capability_evidence` DROP FOREIGN KEY `ai_provider_capability_evidence_profile_fk`,
  ADD CONSTRAINT `ai_provider_capability_evidence_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ai_provider_profiles`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_provider_profiles` DROP FOREIGN KEY `ai_provider_profiles_scope_fk`,
  ADD CONSTRAINT `ai_provider_profiles_scopeId_scopeKind_fkey` FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_budgets` DROP FOREIGN KEY `ai_task_execution_budgets_task_fk`,
  ADD CONSTRAINT `ai_task_execution_budgets_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks`(`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_budget_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_task_execution_budgets`(`scopeId`, `taskId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_invocation_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_gatewayInvocationI_fkey` FOREIGN KEY (`scopeId`, `taskId`, `gatewayInvocationId`) REFERENCES `ai_gateway_invocations`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_run_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_step_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_stepId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `stepId`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_tenant_model_configurations` DROP FOREIGN KEY `ai_tenant_model_configuration_tenant_fk`,
  ADD CONSTRAINT `ai_tenant_model_configurations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ai_budget_policies` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_budget_reservations` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_human_confirmations` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_invocation_admissions` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_knowledge_documents` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_provider_capability_evidence` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_provider_profiles` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_structured_memories` ALTER COLUMN `updatedAt` DROP DEFAULT,
    ALTER COLUMN `ownerKind` DROP DEFAULT,
    ALTER COLUMN `ownerId` DROP DEFAULT;

ALTER TABLE `ai_usage_reservations` ALTER COLUMN `updatedAt` DROP DEFAULT;
