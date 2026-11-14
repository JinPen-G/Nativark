/** Short-lived ownership of public catalog/help material only. This credential
 * grants no customer identity, task, model or business action. The host resolves
 * current channel publication and Auth separately before recording or resuming. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AiClientEntryError } from './client-entry-action';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const channel = z.enum(['web', 'wechat_miniprogram']);
const scope = z.object({ tenantId: id, workspaceId: id, channel }).strict();
const instant = z.string().datetime({ offset: true });
const payload = scope.extend({ version: z.literal('ain-client-public-session-1'), sessionId: z.string().uuid(),
  issuedAt: instant, expiresAt: instant }).strict();
const token = z.string().min(1).max(2048).regex(/^ain-public-1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
const lifetimeMs = 300000;
const denied = () => new AiClientEntryError('AI_ACCESS_DENIED', 'public_session_unavailable');
export type AiClientPublicSessionScope = z.infer<typeof scope>;
export type AiClientPublicSessionIdentity = AiClientPublicSessionScope & {
  sessionHash: string; issuedAt: string; expiresAt: string;
};

export class AiClientPublicSessionCredential {
  constructor(private readonly config: Pick<ConfigService, 'get'>, private readonly clock: () => Date = () => new Date()) {}

  private key() {
    const value: unknown = this.config.get('AUTH_TOKEN_SECRET');
    if (typeof value !== 'string' || !value.trim()) throw denied();
    return value.trim();
  }
  private now() {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw denied();
    return value;
  }
  private sign(value: string, secret: string) {
    return createHmac('sha256', secret).update('rental-os:ai-public-session:1:').update(value).digest('base64url');
  }

  /** Invoked only after the host has observed the current public channel. */
  issue(value: AiClientPublicSessionScope) {
    const expected = scope.safeParse(structuredClone(value));
    if (!expected.success) throw denied();
    const secret = this.key(), now = this.now();
    const issued = payload.parse({ ...expected.data, version: 'ain-client-public-session-1', sessionId: randomUUID(),
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + lifetimeMs).toISOString() });
    const encoded = Buffer.from(JSON.stringify(issued), 'utf8').toString('base64url'), unsigned = `ain-public-1.${encoded}`;
    return { credential: `${unsigned}.${this.sign(unsigned, secret)}`, expiresAt: issued.expiresAt };
  }

  /** Verified ownership hash only; the token itself is never stored in rows. */
  verify(value: unknown, expected: AiClientPublicSessionScope, mode: 'read' | 'write' = 'write'): AiClientPublicSessionIdentity {
    try {
      const supplied = token.parse(value), target = scope.parse(structuredClone(expected)), secret = this.key();
      const [version, encoded, signature] = supplied.split('.'), unsigned = `${version}.${encoded}`;
      const actual = Buffer.from(signature, 'base64url'), canonical = Buffer.from(this.sign(unsigned, secret), 'base64url');
      if (actual.length !== canonical.length || actual.toString('base64url') !== signature || !timingSafeEqual(actual, canonical)) throw denied();
      const bytes = Buffer.from(encoded, 'base64url');
      if (bytes.toString('base64url') !== encoded || bytes.byteLength > 1024) throw denied();
      const recorded = payload.parse(JSON.parse(bytes.toString('utf8'))), now = this.now().getTime();
      const issuedAt = Date.parse(recorded.issuedAt), expiresAt = Date.parse(recorded.expiresAt);
      if (mode !== 'read' && mode !== 'write' || recorded.tenantId !== target.tenantId || recorded.workspaceId !== target.workspaceId || recorded.channel !== target.channel
        || issuedAt > now || mode === 'write' && expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > lifetimeMs) throw denied();
      return { ...target, sessionHash: createHash('sha256').update(supplied).digest('hex'),
        issuedAt: recorded.issuedAt, expiresAt: recorded.expiresAt };
    } catch { throw denied(); }
  }
}
