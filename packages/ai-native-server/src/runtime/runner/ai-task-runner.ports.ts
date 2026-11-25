/** 原 AI 持久化适配的兼容类型出口；公共 Runner 不认识 Prisma 的正文输入类型。 */
import type { Prisma } from '@prisma/client';
export type { AiTaskRunnerClaimInput, AiTaskRunnerLease, AiTaskRunnerRecoveryLease,
  AiTaskRunnerTaskMetadata, AiTaskRunnerOperation, AiTaskRunnerPause, AiTaskRunnerLimits,
  AiTaskRunnerStepPlan, AiTaskRunnerPlan, AiTaskRunnerRegisteredStep,
  AiTaskRunnerConfirmationContinuation, AiTaskRunnerConfirmationRequest,
  AiTaskRunnerConfirmationPort, AiTaskRunnerStepCommit, AiTaskRunnerStepRef,
  AiTaskRunnerEffectResult, AiTaskRunnerLeasePort, AiTaskRunnerStepPort,
  AiTaskRunnerPlanPort, AiTaskRunnerEffectPort, AiTaskRunnerTaskOutcome,
  AiTaskRunnerOutcomePort, AiTaskRunnerClock, AiTaskRunnerInputPort,
  AiTaskRunnerDependencies, AiTaskRunnerResourceTicket, AiTaskRunnerOverheadTicket,
  AiTaskRunnerOverheadPort, AiTaskRunnerResourcePort, AiTaskRunnerInput,
  AiTaskRunnerOutcome } from '@rental-os/platform-server/ai-runtime';

export type AiTaskRunnerObservedResult =
  | { kind: 'succeeded' | 'failed' | 'unknown'; payload: Prisma.InputJsonValue; errorCode?: string }
  | { kind: 'paused'; pause: 'confirmation'; payload: Prisma.InputJsonValue };
