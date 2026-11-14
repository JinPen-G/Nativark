import { requestFingerprint } from '../../common/request-fingerprint';
import type { TenantIntegrationRuntimeConfig } from './tenant-integration.service';

/** Checks the server's original freeze evidence, not current object existence or
 * upload authority. Legacy active files are not silently promoted to evidence. */
export function frozenFileContentHash(asset: {
  id: string; tenantId: string; storageProvider: string; storageKey: string;
  checksum: string | null; metadata: unknown;
}, config?: TenantIntegrationRuntimeConfig): string | undefined {
  const metadata = asset.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const values = metadata as Record<string, unknown>, hash = values.contentHash, staging = values.stagingStorageKey;
  if (values.fileUploadVersion !== 2 || values.fileContentVersion !== 1
    || typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash) || asset.checksum !== hash
    || typeof staging !== 'string' || staging.length > 380
    || staging.split('/').some(part => !part || part === '.' || part === '..')
    || /[\\\u0000-\u001f\u007f]/u.test(staging)
    || !(staging === `${asset.tenantId}/${asset.id}/blob` || staging.endsWith(`/${asset.tenantId}/${asset.id}/blob`))) return undefined;
  const prefix = `${staging}.committed/`;
  if (!asset.storageKey.startsWith(prefix) || !asset.storageKey.endsWith(`/${hash}`)) return undefined;
  const nonce = asset.storageKey.slice(prefix.length, -(hash.length + 1));
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(nonce)) return undefined;
  if (config) {
    const objectPrefix = String(config.settings.objectPrefix ?? 'tenant-files').trim().replace(/^\/+|\/+$/gu, '');
    const expected = `${objectPrefix ? `${objectPrefix}/` : ''}${asset.tenantId}/${asset.id}/blob`;
    if (config.provider !== asset.storageProvider || staging !== expected
      || values.storageLocationHash !== fileStorageLocationHash(config)) return undefined;
  }
  return hash;
}

export function fileStorageLocationHash(config: TenantIntegrationRuntimeConfig) {
  return requestFingerprint([config.id, config.provider, config.settings.bucket ?? null,
    config.settings.endpoint ?? null, config.settings.region ?? null, config.settings.forcePathStyle ?? null]);
}
