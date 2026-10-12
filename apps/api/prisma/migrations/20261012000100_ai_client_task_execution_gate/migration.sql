-- Separate server-owned execution gate. Existing customer read/create policies
-- must not implicitly authorize model dispatch. No policy is enabled here.
ALTER TABLE `ai_client_task_policies`
  ADD COLUMN `allowExecute` BOOLEAN NOT NULL DEFAULT false;
