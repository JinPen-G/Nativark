import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service';
import { AiTaskListRepository } from './ai-task-list.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { AiScopeRepository } from './ai-scope.repository';
import { composePrismaTaskCurrentActionAuthority } from './prisma-task-action-policy.source';

/** Owner-only metadata listing. Every candidate (including the pagination sentinel)
 * requires the existing read_metadata policy before returning anything. Missing
 * policies refuse the whole page, not a misleading empty success. Historical reads
 * do not create a run or require a new model/budget allowance. No production route.
 */
export function composePersistedTaskList(input: {
  db: Pick<PrismaClient, 'aiTask' | 'aiScope' | 'aiTaskActionPolicy'>;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  credentials: AiTaskCredentialSource;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  const identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock);
  const scopes = new AiScopeRepository(input.db, identity, clock);
  const actions = composePrismaTaskCurrentActionAuthority({ ...input, scopes, clock });
  return new AiTaskListRepository(input.db, {
    resolveList: async () => (await scopes.resolveCurrent()).context,
    authorizeMetadata: taskId => actions.resolve(taskId, 'read_metadata')
  }, clock);
}
