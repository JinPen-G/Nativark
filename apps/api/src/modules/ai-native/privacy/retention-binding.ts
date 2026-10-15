import { createHash } from 'node:crypto';

/** Stable immutable object identity; mutable status/updatedAt are not authority. */
export function aiRetentionObjectHash(asset: {
  id: string; tenantId: string; businessModule: string; businessType: string; businessId: string | null;
  storageProvider: string; storageKey: string; checksum: string | null; sizeBytes: number; createdAt: Date; metadata?: unknown;
}) {
  return createHash('sha256').update(JSON.stringify([asset.id, asset.tenantId, asset.businessModule,
    asset.businessType, asset.businessId, asset.storageProvider, asset.storageKey, asset.checksum,
    asset.sizeBytes, asset.createdAt.toISOString(), asset.metadata && typeof asset.metadata === 'object'
      && 'storageLocationHash' in asset.metadata ? asset.metadata.storageLocationHash : null])).digest('hex');
}
