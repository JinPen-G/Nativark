-- Independent client input actions; existing execution grants enable none.
ALTER TABLE `ai_client_task_policies`
  ADD COLUMN `allowRequestInput` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `allowSubmitInput` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `allowResumeInput` BOOLEAN NOT NULL DEFAULT false;
