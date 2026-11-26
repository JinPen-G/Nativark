/** Workspace Web adapter of the same current Task action checks. */
import type { AuthService } from './rental-adapters/auth.service';
import { AiTaskRepositoryError } from '../task-errors';
import type { AiStepReplayAuthority } from './ai-step-registration.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiTaskActionChecks, type AiTaskActionPolicySource } from './task-action-checks';
export type { AiTaskActionPolicySource } from './task-action-checks';

export interface AiTaskCredentialSource {
  current(): Promise<{ authorization: string; requestId: string; audience: 'operator' | 'staff' }>;
}

export class AiTaskCurrentActionAuthority extends AiTaskActionChecks {
  constructor(auth: Pick<AuthService, 'resolveAccessContext'>, credentials: AiTaskCredentialSource, policies: AiTaskActionPolicySource,
    clock: () => Date = () => new Date()) {
    if (typeof auth?.resolveAccessContext !== 'function' || typeof credentials?.current !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    super(new AiTaskCurrentIdentityAuthority(auth, credentials, clock), policies, clock);
  }

  stepReplayAuthority(): AiStepReplayAuthority {
    return { resolve: command => this.resolve(command.taskId, 'read_step_terminal') };
  }
}
