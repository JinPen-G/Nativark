-- New creation requests must store their complete frozen-input fingerprint bundle.
-- NULL bundles preserve pre-existing tasks; no legacy fingerprint is invented.
ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_creation_evidence` CHECK (
  (`creationKey` IS NULL AND `creationFingerprint` IS NULL AND `inputRevision` IS NULL AND `inputHash` IS NULL)
  OR (`creationKey` IS NOT NULL AND CHAR_LENGTH(`creationKey`) > 0
      AND `creationFingerprint` IS NOT NULL AND CHAR_LENGTH(`creationFingerprint`) = 64
      AND `inputRef` IS NOT NULL AND CHAR_LENGTH(`inputRef`) > 0
      AND `inputRevision` IS NOT NULL AND `inputRevision` > 0
      AND `inputHash` IS NOT NULL AND CHAR_LENGTH(`inputHash`) = 64)
);
