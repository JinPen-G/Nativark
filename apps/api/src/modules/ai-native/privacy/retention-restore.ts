import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { AI_RETENTION_POLICY } from './retention-policy';

export const retentionKinds = ['task', 'request', 'knowledge', 'memory', 'material', 'attachment'] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), id = z.string().min(1).max(191);
const tombstone = z.object({ kind: z.enum(retentionKinds), resourceId: id, targetHash: hash,
  mode: z.enum(['erase', 'withdraw']).default('erase') }).strict();
const manifest = z.object({ version: z.literal('ai-restore-tombstones-1'), policyVersion: z.literal(AI_RETENTION_POLICY.version),
  tenantId: id, workspaceId: id, snapshotId: z.string().uuid(), snapshotSha256: hash, snapshotCreatedAt: z.string().datetime(),
  issuedAt: z.string().datetime(), complete: z.literal(true), tombstones: z.array(tombstone).max(500) }).strict();
type Manifest = z.infer<typeof manifest>;
export type AiRestorePermit = Readonly<{ keyHash: string; manifest: Readonly<Manifest> }>;
const permits = new WeakSet<object>();
export function retentionPublicKeyHash(key: string | KeyObject) {
  const publicKey = typeof key === 'string' ? createPublicKey(key) : key.type === 'public' ? key : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw Error('AI_RETENTION_RESTORE_UNAVAILABLE');
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}
/** The key is trusted SERVER configuration, never a request field. Old backup
 * copies of the ledger cannot authorize themselves: require a freshly signed,
 * complete export from the live ledger kept outside the restored snapshot.
 */
export class AiRetentionRestoreVerifier {
  constructor(private readonly publicKey: string | KeyObject, private readonly clock: () => Date = () => new Date()) {
    retentionPublicKeyHash(publicKey);
  }
  verify(value: unknown): AiRestorePermit {
    const envelope = z.object({ payload: z.string().max(262144), signature: z.string().max(128) }).strict().parse(value);
    if (!verify(null, Buffer.from(envelope.payload), this.publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('AI_RETENTION_RESTORE_UNAVAILABLE');
    const parsed = manifest.parse(JSON.parse(envelope.payload)), now = this.clock().getTime();
    if (!Number.isFinite(now) || Date.parse(parsed.issuedAt) > now || now - Date.parse(parsed.issuedAt) > 60000
      || Date.parse(parsed.snapshotCreatedAt) > Date.parse(parsed.issuedAt)
      || now - Date.parse(parsed.snapshotCreatedAt) > AI_RETENTION_POLICY.backupMaximumDays * 86400000
      || new Set(parsed.tombstones.map(row => `${row.kind}:${row.resourceId}`)).size !== parsed.tombstones.length) throw Error('AI_RETENTION_RESTORE_UNAVAILABLE');
    parsed.tombstones.forEach(Object.freeze); Object.freeze(parsed.tombstones); Object.freeze(parsed);
    const permit = Object.freeze({ keyHash: retentionPublicKeyHash(this.publicKey), manifest: parsed });
    permits.add(permit); return permit;
  }
}
export function requireRestorePermit(permit: AiRestorePermit, keyHash: string | undefined,
  scope: { tenantId: string; workspaceId: string }, now: Date) {
  if (!permit || !permits.has(permit) || !keyHash || permit.keyHash !== keyHash
    || permit.manifest.tenantId !== scope.tenantId || permit.manifest.workspaceId !== scope.workspaceId
    || !Number.isFinite(now.getTime()) || Date.parse(permit.manifest.issuedAt) > now.getTime()
    || now.getTime() - Date.parse(permit.manifest.issuedAt) > 60000) throw Error('AI_RETENTION_RESTORE_UNAVAILABLE');
  return permit.manifest;
}
export function signRetentionManifest(value: unknown, privateKey: KeyObject) {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw Error('AI_RETENTION_RESTORE_UNAVAILABLE');
  const payload = JSON.stringify(manifest.parse(value));
  return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
}
