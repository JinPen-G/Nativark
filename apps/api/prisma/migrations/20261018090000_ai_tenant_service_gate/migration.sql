-- Preserve all existing settings, ciphertext and revisions. NULL is the
-- compatibility state; only an authorized CAS save sets the explicit gate.
ALTER TABLE `ai_tenant_model_configurations`
  ADD COLUMN `serviceEnabled` BOOLEAN NULL;
