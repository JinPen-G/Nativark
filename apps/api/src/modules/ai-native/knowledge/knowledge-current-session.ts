import type { AiExecutionContext } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import type { KnowledgeAuthorizationPort, KnowledgeClock } from './knowledge.ports';
import { requiredPort, unavailable } from './knowledge-errors';
import { authorize, fingerprint, sameScope } from './knowledge-validation';

const key = (context: AiExecutionContext) => fingerprint([context.actor, context.audience, context.scope,
  'access' in context ? context.access : null]);

/** Current identity is necessary, never sufficient for a document action. */
export class KnowledgeCurrentSession {
  private readonly identity: AiTaskCurrentIdentityAuthority;
  constructor(auth: Pick<AuthService, 'resolveAccessContext'>, credentials: AiTaskCredentialSource, clock: KnowledgeClock) {
    requiredPort(clock, ['now']);
    this.identity = new AiTaskCurrentIdentityAuthority(auth, credentials, () => new Date(clock.now()));
  }
  async current(): Promise<AiExecutionContext> {
    try { return await this.identity.resolve(); } catch { return unavailable(); }
  }
  async check(context: AiExecutionContext): Promise<void> {
    if (key(await this.current()) !== key(context)) unavailable();
  }
  bind(source: KnowledgeAuthorizationPort): KnowledgeAuthorizationPort {
    requiredPort(source, ['authorize']);
    return { authorize: async (context, request) => {
      await this.check(context);
      if (!sameScope(context.scope, request.scope)) return unavailable();
      const stable = structuredClone(context), input = structuredClone(request);
      const contextHash = fingerprint(stable), inputHash = fingerprint(input);
      const grant = await source.authorize(stable, input);
      if (fingerprint(stable) !== contextHash || fingerprint(input) !== inputHash) unavailable();
      await this.check(context);
      if (!grant) return null;
      // Reuse the canonical grant validator, not a second ACL interpretation.
      return authorize({ authorize: async () => structuredClone(grant) }, context, request);
    } };
  }
  async run<T>(callback: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    const context = await this.current(), hash = fingerprint(context);
    const result = await callback(context);
    if (fingerprint(context) !== hash) unavailable();
    await this.check(context);
    return structuredClone(result);
  }
}
