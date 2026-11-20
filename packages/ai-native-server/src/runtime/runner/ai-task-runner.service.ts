/** 原 AI Native Runner 兼容出口。公共包持有唯一实现和错误类，保持原租约、计量及恢复语义。 */
export { AiTaskRunner, AiTaskRunnerError, AiTaskRunnerPreReservationLimitError,
  AiTaskRunnerOriginalStepUnavailableError, snapshotAiTaskRunnerClaimLease,
  snapshotAiTaskRunnerRecoveryLease, callAiTaskRunnerDependency,
  withAiTaskHeldPreparationDefinition, inheritAiTaskHeldPreparation,
  withAiTaskHeldPreparationWindow } from '@rental-os/platform-server/ai-runtime';
export type { AiTaskHeldPreparation } from '@rental-os/platform-server/ai-runtime';
