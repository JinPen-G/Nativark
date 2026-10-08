-- AI foundation guards (not representable in Prisma).
-- Requires MySQL >= 8.0.16 with enforced CHECK constraints; real DB proof is a separate gate.
-- All timestamps are UTC DATETIME(3). References carry no business facts or credentials.
-- Explicit IS NULL/IS NOT NULL prevents SQL UNKNOWN from bypassing optional-field guards.

ALTER TABLE `ai_scopes` ADD CONSTRAINT `ai_scopes_shape` CHECK (
  (`kind` = 'platform' AND `tenantId` IS NULL AND `workspaceId` IS NULL AND `scopeKey` = 'platform')
  OR (`kind` = 'tenant' AND `tenantId` IS NOT NULL AND CHAR_LENGTH(`tenantId`) > 0
      AND `workspaceId` IS NULL AND `scopeKey` = CONCAT('tenant:', CHAR_LENGTH(`tenantId`), ':', `tenantId`))
  OR (`kind` = 'workspace' AND `tenantId` IS NOT NULL AND CHAR_LENGTH(`tenantId`) > 0
      AND `workspaceId` IS NOT NULL AND CHAR_LENGTH(`workspaceId`) > 0
      AND `scopeKey` = CONCAT('workspace:', CHAR_LENGTH(`tenantId`), ':', `tenantId`, ':', CHAR_LENGTH(`workspaceId`), ':', `workspaceId`))
);

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_actor_scope` CHECK (
  (`ownerKind` = 'saas_admin' AND `audience` = 'operator' AND `scopeKind` = 'platform')
  OR (`ownerKind` = 'user' AND `audience` IN ('operator', 'staff') AND `scopeKind` IN ('tenant', 'workspace'))
  OR (`ownerKind` = 'customer' AND `audience` = 'client' AND `scopeKind` IN ('tenant', 'workspace'))
  OR (`ownerKind` = 'automation' AND `audience` = 'automation' AND `scopeKind` IN ('tenant', 'workspace'))
);
ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_policy` CHECK (
  (`ownerKind` = 'automation' AND `policyId` IS NOT NULL AND CHAR_LENGTH(`policyId`) > 0
      AND `policyRevision` IS NOT NULL AND `policyRevision` > 0 AND `policyExpiresAt` IS NOT NULL)
  OR (`ownerKind` <> 'automation' AND `policyId` IS NULL AND `policyRevision` IS NULL AND `policyExpiresAt` IS NULL)
);
ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_revision_owner` CHECK (`revision` > 0 AND CHAR_LENGTH(`ownerId`) > 0);
ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_cancel_marker` CHECK (`status` <> 'cancel_requested' OR `cancelRequestedAt` IS NOT NULL);

ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_revision_sequence` CHECK (`revision` > 0 AND `sequence` > 0 AND CHAR_LENGTH(`actorId`) > 0);
ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_lease` CHECK (
  `fencingToken` >= 0 AND (
    (`leaseOwnerId` IS NULL AND `leaseExpiresAt` IS NULL)
    OR (`leaseOwnerId` IS NOT NULL AND CHAR_LENGTH(`leaseOwnerId`) > 0 AND `leaseExpiresAt` IS NOT NULL AND `fencingToken` > 0)
  )
);

ALTER TABLE `ai_steps` ADD CONSTRAINT `ai_steps_revision_sequence` CHECK (`revision` > 0 AND `sequence` > 0);
ALTER TABLE `ai_steps` ADD CONSTRAINT `ai_steps_outcome` CHECK (
  (`status` IN ('pending', 'cancelled') AND `effect` = 'none' AND `errorCode` IS NULL)
  OR (`status` = 'running' AND `effect` IN ('none', 'possible') AND `errorCode` IS NULL)
  OR (`status` = 'failed' AND `effect` = 'none' AND `errorCode` IS NOT NULL
      AND CHAR_LENGTH(`errorCode`) > 0 AND `errorCode` <> 'AI_RESULT_UNKNOWN')
  OR (`status` = 'succeeded' AND `effect` IN ('none', 'committed') AND `errorCode` IS NULL
      AND (`effect` = 'none' OR (`resultRef` IS NOT NULL AND CHAR_LENGTH(`resultRef`) > 0)))
  OR (`status` = 'unknown' AND `effect` = 'possible' AND `errorCode` IS NOT NULL AND `errorCode` = 'AI_RESULT_UNKNOWN')
);

ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_current` CHECK (
  `stateRevision` > 0 AND (`currentRevision` IS NULL OR `currentRevision` > 0)
  AND (`status` <> 'confirmed' OR `currentRevision` IS NOT NULL)
);
ALTER TABLE `ai_proposal_versions` ADD CONSTRAINT `ai_proposal_versions_revision` CHECK (`revision` > 0);
ALTER TABLE `ai_proposal_versions` ADD CONSTRAINT `ai_proposal_versions_payload_identity` CHECK (
  JSON_EXTRACT(`payload`, '$.proposalId') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.proposalId')) = 'STRING'
  AND JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.proposalId')) = `proposalId`
  AND JSON_EXTRACT(`payload`, '$.taskId') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.taskId')) = 'STRING'
  AND JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.taskId')) = `taskId`
  AND JSON_EXTRACT(`payload`, '$.revision') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.revision')) = 'INTEGER'
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.revision')) AS UNSIGNED) = `revision`
);
ALTER TABLE `ai_proposal_actions` ADD CONSTRAINT `ai_proposal_actions_sequence` CHECK (`proposalRevision` > 0 AND `sequence` > 0);

ALTER TABLE `ai_approvals` ADD CONSTRAINT `ai_approvals_human` CHECK (
  (`actorKind` = 'saas_admin' AND `audience` = 'operator')
  OR (`actorKind` = 'user' AND `audience` IN ('operator', 'staff'))
  OR (`actorKind` = 'customer' AND `audience` = 'client')
);
ALTER TABLE `ai_approvals` ADD CONSTRAINT `ai_approvals_expiry` CHECK (
  `proposalRevision` > 0 AND CHAR_LENGTH(`actorId`) > 0 AND `expiresAt` > `issuedAt`
);
ALTER TABLE `ai_approval_consumptions` ADD CONSTRAINT `ai_consumptions_result` CHECK (
  `proposalRevision` > 0 AND CHAR_LENGTH(`businessIdempotencyKey`) > 0
  AND (`status` <> 'committed' OR (`resultRef` IS NOT NULL AND CHAR_LENGTH(`resultRef`) > 0))
);
ALTER TABLE `ai_task_events` ADD CONSTRAINT `ai_task_events_revision` CHECK (`taskRevision` > 0 AND `cursor` > 0);
ALTER TABLE `ai_task_events` ADD CONSTRAINT `ai_task_events_type` CHECK (
  `type` IN ('task.transition', 'step.changed', 'task.output_ready', 'access.revoked')
);
