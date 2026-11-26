/** Typed result of a registered effect. Measurements come from the store. */
import type { Prisma } from '@prisma/client';

export type AiTaskRunnerObservedResult =
  | { kind: 'succeeded' | 'failed' | 'unknown'; payload: Prisma.InputJsonValue; errorCode?: string }
  | { kind: 'paused'; pause: 'confirmation'; payload: Prisma.InputJsonValue };
