import { createHash, createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { assertOutboundUrl } from '../../common/outbound-url';
import { frozenFileContentHash } from './file-content-binding';
import type { TenantIntegrationService, TenantIntegrationRuntimeConfig } from './tenant-integration.service';

type Reference = { tenantId: string; workspaceId: string; fileAssetId: string; provider: string; storageKey: string };
const unavailable = () => new Error('Inspection object storage unavailable');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/gu, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const value = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || /[\r\n]/u.test(v)) throw unavailable(); return v.trim(); };

/** Internal request construction only. Never returns a presigned/bearer URL.
 * Uses the same S3 endpoint/path-style configuration as FileStorageRuntime. */
export function s3ObjectReadRequest(config: TenantIntegrationRuntimeConfig, storageKey: string, at: Date) {
  if (config.provider !== 's3_compatible' || !Number.isFinite(at.getTime())) throw unavailable();
  const bucket = value(config.settings.bucket), region = value(config.settings.region);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) || !/^[a-z0-9-]+$/u.test(region)
    || !storageKey || storageKey.length > 2048 || storageKey.split('/').some(p => p === '.' || p === '..' || !p)
    || /[\u0000-\u001f\u007f\\]/u.test(storageKey)) throw unavailable();
  const url = new URL(value(config.settings.endpoint));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw unavailable();
  const pathStyle = config.settings.forcePathStyle === true || String(config.settings.forcePathStyle).toLowerCase() === 'true';
  if (!pathStyle) url.hostname = `${bucket}.${url.hostname}`;
  const path = `/${pathStyle ? `${encode(bucket)}/` : ''}${storageKey.split('/').map(encode).join('/')}`;
  url.pathname = path;
  const amzDate = at.toISOString().replace(/[:-]|\.\d{3}/gu, ''), date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`, payloadHash = hash('');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = `GET\n${path}\n\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\n${signedHeaders}\n${payloadHash}`;
  const key = mac(mac(mac(mac(`AWS4${value(config.credentials.secretAccessKey)}`, date), region), 's3'), 'aws4_request');
  const signature = mac(key, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonical)}`).toString('hex');
  return { url: url.toString(), headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${value(config.credentials.accessKeyId)}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` } };
}

/** Structurally implements INSPECTION_OBJECT_READER.open without depending on
 * the AI module. Current business authorization remains the consumer's job.
 * This producer independently checks the persisted upload and order scope.
 * Explicit injection only; no bootstrap, credentials from caller, or SDK types. */
export class TenantInspectionObjectReader {
  constructor(private readonly db: Pick<PrismaClient, 'fileAsset' | 'rentalOrder'>,
    private readonly integrations: Pick<TenantIntegrationService, 'runtimeConfig'>,
    private readonly transport: typeof fetch = globalThis.fetch,
    private readonly egress: typeof assertOutboundUrl = assertOutboundUrl,
    private readonly clock: () => Date = () => new Date()) {}

  async open(input: Reference, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const ref = structuredClone(input);
    if (signal.aborted || ref.provider !== 's3_compatible') throw unavailable();
    const load = () => this.db.fileAsset.findFirst({ where: { id: ref.fileAssetId, tenantId: ref.tenantId, status: 'active',
      businessType: 'rental_order', storageProvider: ref.provider, storageKey: ref.storageKey }, include: { uploadSession: true } });
    const asset = structuredClone(await load());
    if (!asset || asset.id !== ref.fileAssetId || asset.tenantId !== ref.tenantId || asset.status !== 'active'
      || asset.storageProvider !== ref.provider || asset.storageKey !== ref.storageKey || asset.businessType !== 'rental_order'
      || !['pickup-evidence', 'return-evidence'].includes(asset.uploadScene) || !asset.businessId
      || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > 20 * 1024 * 1024
      || asset.uploadSession?.status !== 'completed' || !asset.uploadSession.completedAt
      || asset.uploadSession.fileAssetId !== asset.id || asset.uploadSession.tenantId !== ref.tenantId
      || asset.uploadSession.storageKey !== ref.storageKey || asset.uploadSession.provider !== ref.provider) throw unavailable();
    const order = await this.db.rentalOrder.findFirst({ where: { id: asset.businessId, tenantId: ref.tenantId, workspaceId: ref.workspaceId }, select: { id: true } });
    if (!order || order.id !== asset.businessId) throw unavailable();
    const config = structuredClone(await this.integrations.runtimeConfig('file', ref.tenantId, 's3_compatible'));
    if (!config) throw unavailable();
    const frozenHash = frozenFileContentHash(asset, config);
    if (!frozenHash) throw unavailable();
    const request = s3ObjectReadRequest(config, ref.storageKey, this.clock());
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const wait = async <T>(operation: Promise<T>): Promise<T> => {
      let rejectAbort: () => void = () => undefined;
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(unavailable()); });
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
      try { return await Promise.race([operation, aborted]); }
      finally { controller.signal.removeEventListener('abort', rejectAbort); }
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const stop = () => { controller.abort(); if (reader) void reader.cancel().catch(() => undefined); cleanup(); };
    try {
      if (signal.aborted) abort();
      const url = await wait(this.egress(request.url, '检查证据对象地址', { allowQuery: false }));
      if (controller.signal.aborted) throw unavailable();
      const responseOperation = this.transport(url, { method: 'GET', headers: request.headers, redirect: 'error', signal: controller.signal });
      void responseOperation.then(response => {
        if (controller.signal.aborted && response.body) void response.body.cancel().catch(() => undefined);
      }, () => undefined);
      const response = await wait(responseOperation);
      const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (!response.ok || !response.body || mediaType !== asset.mimeType.split(';', 1)[0].trim().toLowerCase()
        || response.headers.get('content-length') !== String(asset.sizeBytes)) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw unavailable();
      }
      reader = response.body.getReader();
      const latest = await wait(load());
      const currentConfig = await wait(this.integrations.runtimeConfig('file', ref.tenantId, 's3_compatible'));
      const currentOrder = await wait(this.db.rentalOrder.findFirst({ where: { id: asset.businessId, tenantId: ref.tenantId, workspaceId: ref.workspaceId }, select: { id: true } }));
      if (JSON.stringify(latest) !== JSON.stringify(asset) || JSON.stringify(currentConfig) !== JSON.stringify(config)
        || !currentOrder || currentOrder.id !== asset.businessId || controller.signal.aborted) throw unavailable();
      const orderId = asset.businessId;
      const finalEvidence = () => Promise.all([
        wait(load()), wait(this.integrations.runtimeConfig('file', ref.tenantId, 's3_compatible')),
        wait(this.db.rentalOrder.findFirst({ where: { id: orderId, tenantId: ref.tenantId, workspaceId: ref.workspaceId }, select: { id: true } }))
      ]);
      let total = 0;
      const digest = createHash('sha256');
      return new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            if (controller.signal.aborted) throw unavailable();
            const next = await wait(reader!.read());
            if (controller.signal.aborted) throw unavailable();
            if (next.done) {
              if (total !== asset.sizeBytes || digest.digest('hex') !== frozenHash) throw unavailable();
              const [finalAsset, finalConfig, finalOrder] = await finalEvidence();
              if (JSON.stringify(finalAsset) !== JSON.stringify(asset) || JSON.stringify(finalConfig) !== JSON.stringify(config)
                || !finalOrder || finalOrder.id !== asset.businessId || controller.signal.aborted) throw unavailable();
              cleanup(); reader!.releaseLock(); output.close(); return;
            }
            if (!(next.value instanceof Uint8Array) || (total += next.value.byteLength) > asset.sizeBytes) throw unavailable();
            digest.update(next.value);
            output.enqueue(next.value);
          } catch { stop(); output.error(unavailable()); }
        },
        cancel() { stop(); }
      });
    } catch { stop(); throw unavailable(); }
  }
}
