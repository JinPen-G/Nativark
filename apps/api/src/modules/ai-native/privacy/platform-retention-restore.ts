/** 平台删除标记的独立恢复凭证。固定服务端Ed25519公钥、原快照与
 * PLATFORM/null归属必须一致；工作空间凭证不可复用。签名和读取都不
 * 放行业务、模型或恢复库，重放成功后仍须原恢复屏障逐范围验证。 */
import { sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { AI_RETENTION_POLICY } from './retention-policy';
import { retentionPublicKeyHash } from './retention-restore';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const platformRetentionKinds = ['task', 'request'] as const;
const manifest = z.object({ version: z.literal('ai-platform-restore-tombstones-1'),
  policyVersion: z.literal(AI_RETENTION_POLICY.version), scopeKind: z.literal('PLATFORM'), scopeId: id.max(36),
  tenantId: z.null(), workspaceId: z.null(), snapshotId: z.string().uuid(), snapshotSha256: hash,
  snapshotCreatedAt: z.string().datetime(), issuedAt: z.string().datetime(), complete: z.literal(true),
  tombstones: z.array(z.object({ kind: z.enum(platformRetentionKinds), resourceId: id,
    targetHash: hash }).strict()).max(500) }).strict();
export type AiPlatformRetentionRestorePermit = Readonly<{ keyHash: string;
  manifest: Readonly<z.infer<typeof manifest>> }>;
const permits = new WeakSet<object>();
const unavailable = () => Error('AI_RETENTION_RESTORE_UNAVAILABLE');

function checked(value: unknown, now: Date) {
  const parsed = manifest.parse(value), time = now.getTime(), issued = Date.parse(parsed.issuedAt);
  if (!Number.isFinite(time) || issued > time || time - issued > 60000
    || Date.parse(parsed.snapshotCreatedAt) > issued
    || time - Date.parse(parsed.snapshotCreatedAt) > AI_RETENTION_POLICY.backupMaximumDays * 86400000
    || new Set(parsed.tombstones.map(row => `${row.kind}:${row.resourceId}`)).size !== parsed.tombstones.length) throw unavailable();
  return parsed;
}

export class AiPlatformRetentionRestoreVerifier {
  constructor(private readonly publicKey: string | KeyObject, private readonly clock: () => Date = () => new Date()) {
    retentionPublicKeyHash(publicKey);
  }
  verify(value: unknown): AiPlatformRetentionRestorePermit {
    try {
      const envelope = z.object({ payload: z.string().max(262144), signature: z.string().max(128) }).strict().parse(value);
      const signature = Buffer.from(envelope.signature, 'base64');
      if (signature.toString('base64') !== envelope.signature
        || !verify(null, Buffer.from(envelope.payload), this.publicKey, signature)) throw unavailable();
      const parsed = checked(JSON.parse(envelope.payload), this.clock());
      parsed.tombstones.forEach(Object.freeze); Object.freeze(parsed.tombstones); Object.freeze(parsed);
      const permit = Object.freeze({ keyHash: retentionPublicKeyHash(this.publicKey), manifest: parsed });
      permits.add(permit); return permit;
    } catch { throw unavailable(); }
  }
}

export function requirePlatformRestorePermit(value: AiPlatformRetentionRestorePermit, keyHash: string | undefined,
  scopeId: string, now: Date) {
  if (!value || !permits.has(value) || !keyHash || value.keyHash !== keyHash
    || value.manifest.scopeId !== scopeId) throw unavailable();
  return checked(value.manifest, now);
}

export function signPlatformRetentionManifest(value: unknown, privateKey: KeyObject) {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw unavailable();
  const payload = JSON.stringify(manifest.parse(value));
  if (Buffer.byteLength(payload, 'utf8') > 262144) throw unavailable();
  return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
}
