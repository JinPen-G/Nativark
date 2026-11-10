-- Align persisted event validation with the frozen shared task-event contract.
-- Preserve all original kinds and historical rows; permit only the two existing
-- producers omitted by the foundation CHECK, never arbitrary event names.
-- A single ALTER replaces the constraint atomically on supported MySQL 8.
ALTER TABLE `ai_task_events`
  DROP CHECK `ai_task_events_type`,
  ADD CONSTRAINT `ai_task_events_type` CHECK (
    `type` IN (
      'task.transition',
      'step.registered',
      'step.changed',
      'task.output_ready',
      'task.input_refreshed',
      'access.revoked'
    )
  );
