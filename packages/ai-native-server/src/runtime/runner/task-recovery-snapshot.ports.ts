import type { AiTaskRecoverySnapshot } from '@rental-os/shared';
export type { AiTaskRecoverySnapshot } from '@rental-os/shared';

export interface AiTaskRecoverySnapshotSource {
  read(value: unknown): Promise<AiTaskRecoverySnapshot>;
}
