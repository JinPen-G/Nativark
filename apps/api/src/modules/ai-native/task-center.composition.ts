import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service';
import { AiTaskEventRepository } from './ai-task-event.repository';
import { AiTaskListRepository } from './ai-task-list.repository';
import { AiTaskRepository } from './ai-task.repository';
import { AiTaskResultRepository } from './runner/ai-task-result.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { composePrismaTaskCurrentActionAuthority } from './prisma-task-action-policy.source';

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskResultArtifact' | 'aiScope' | 'aiTaskActionPolicy'>;

/**
 * Explicit read-only task-center composition. It exposes metadata, events and
 * durable results through the same current identity/action-policy boundary;
 * it does not register a route, start a worker, or create a task.
 */
export function composePersistedTaskCenter(input: {
  db: Db;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  credentials: AiTaskCredentialSource;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  const identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock);
  const scopes = new AiScopeRepository(input.db, identity, clock);
  const actions = composePrismaTaskCurrentActionAuthority({ ...input, scopes, clock });
  const tasks = new AiTaskRepository(input.db, actions, clock);
  const list = new AiTaskListRepository(input.db, {
    resolveList: async () => (await scopes.resolveCurrent()).context,
    authorizeMetadata: taskId => actions.resolve(taskId, 'read_metadata')
  }, clock);
  const events = new AiTaskEventRepository(input.db, actions, clock);
  const results = new AiTaskResultRepository(input.db, tasks, clock);
  return Object.freeze({ list, events, results });
}
