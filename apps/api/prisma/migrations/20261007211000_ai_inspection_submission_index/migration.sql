CREATE UNIQUE INDEX `ai_inspection_draft_action_key`
ON `ai_inspection_drafts` (`tenantId`, `workspaceId`, `submissionActionId`);
