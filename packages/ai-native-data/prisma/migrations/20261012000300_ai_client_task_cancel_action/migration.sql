-- Requesting cancellation is independent of reading or dispatching a task.
-- Existing customer policies do not receive this action implicitly.
ALTER TABLE `ai_client_task_policies`
  ADD COLUMN `allowCancel` BOOLEAN NOT NULL DEFAULT false;
