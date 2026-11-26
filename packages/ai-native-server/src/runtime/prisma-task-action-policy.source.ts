/** Original Rental identity adapter for the public persisted Task action policy. */
import type { PrismaClient } from '@prisma/client';
import { AiTaskCurrentActionAuthority, type AiTaskCredentialSource } from './task-current-action.authority';
import type { AiScopeRepository } from './ai-scope.repository';
import { PrismaTaskActionPolicySource } from './task-action-policy.reader';
export { PrismaTaskActionPolicySource } from './task-action-policy.reader';

/** Explicit composition helper. It creates no Nest provider and does not widen
 * the authority boundary; the caller must supply the real AuthService,
 * credential source and current scope repository. */
export function composePrismaTaskCurrentActionAuthority(input: {
  auth: ConstructorParameters<typeof AiTaskCurrentActionAuthority>[0];
  credentials: AiTaskCredentialSource;
  db: Pick<PrismaClient, 'aiTaskActionPolicy'>;
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  const policies = new PrismaTaskActionPolicySource(input.db, input.scopes, clock);
  return new AiTaskCurrentActionAuthority(input.auth, input.credentials, policies, clock);
}
