/** Rental 检查对象的原字节读取，核上传事实、订单空间和冻结摘要，并在读取后及流末复验。当前业务授权由消费者裁定，存储配置由宿主提供。 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { frozenFileContentHash } from '@rental-os/platform-contracts/file-content-binding';
import { s3ObjectReadRequest } from '@rental-os/platform-server/files';
import { assertOutboundUrl } from '@rental-os/platform-server/outbound-url';
import type { TenantIntegrationService } from '@rental-os/platform-server/tenant-integration';

type Reference = { tenantId: string; workspaceId: string; fileAssetId: string; provider: string; storageKey: string };
const unavailable = () => new Error('Inspection object storage unavailable');

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
