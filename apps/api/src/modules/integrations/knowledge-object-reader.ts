import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { assertOutboundUrl } from '../../common/outbound-url';
import type { TenantIntegrationService } from './tenant-integration.service';
import { s3ObjectReadRequest } from './inspection-object-reader';

export type KnowledgeObjectReference = { tenantId: string; workspaceId: string; documentId: string; fileAssetId: string };
const unavailable = () => new Error('Knowledge object storage unavailable');

export class TenantKnowledgeObjectReader {
  constructor(private readonly db: Pick<PrismaClient, 'fileAsset' | 'aiKnowledgeDocument'>,
    private readonly integrations: Pick<TenantIntegrationService, 'runtimeConfig'>,
    private readonly transport: typeof fetch = globalThis.fetch,
    private readonly egress: typeof assertOutboundUrl = assertOutboundUrl,
    private readonly clock: () => Date = () => new Date()) {}

  async read(input: KnowledgeObjectReference, maxBytes: number, signal?: AbortSignal) {
    const ref = structuredClone(input);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144 || signal?.aborted) throw unavailable();
    const control = new AbortController(), abort = () => control.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    const wait = async <T>(work: Promise<T>): Promise<T> => {
      let rejectAbort: () => void = () => undefined;
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(unavailable()); });
      control.signal.addEventListener('abort', rejectAbort, { once: true });
      if (control.signal.aborted) rejectAbort();
      try { return await Promise.race([work, aborted]); }
      finally { control.signal.removeEventListener('abort', rejectAbort); }
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const load = () => this.db.fileAsset.findFirst({ where: { id: ref.fileAssetId, tenantId: ref.tenantId,
        businessType: 'ai_knowledge_document', businessId: ref.documentId, uploadScene: 'ai-knowledge', status: 'active' }, include: { uploadSession: true } });
      const document = () => this.db.aiKnowledgeDocument.findFirst({ where: { id: ref.documentId, tenantId: ref.tenantId, workspaceId: ref.workspaceId } });
      const asset = structuredClone(await wait(load())), head = structuredClone(await wait(document()));
      const metadata = asset?.metadata;
      if (!asset || asset.id !== ref.fileAssetId || asset.tenantId !== ref.tenantId || asset.businessId !== ref.documentId
        || asset.businessType !== 'ai_knowledge_document' || asset.businessModule !== 'ai-native' || asset.uploadScene !== 'ai-knowledge'
        || asset.status !== 'active' || asset.storageProvider !== 's3_compatible' || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
        || metadata.workspaceId !== ref.workspaceId || metadata.knowledgeUploadVersion !== 1
        || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > maxBytes
        || !head || head.id !== ref.documentId || head.tenantId !== ref.tenantId || head.workspaceId !== ref.workspaceId
        || !['draft', 'published'].includes(head.status)
        || asset.uploadSession?.status !== 'completed' || !asset.uploadSession.completedAt || asset.uploadSession.fileAssetId !== asset.id
        || asset.uploadSession.tenantId !== ref.tenantId || asset.uploadSession.storageKey !== asset.storageKey
        || asset.uploadSession.provider !== asset.storageProvider) throw unavailable();
      const state = head.state;
      if (!state || typeof state !== 'object' || Array.isArray(state) || !state.document || typeof state.document !== 'object'
        || Array.isArray(state.document) || state.document.attachmentId !== asset.id) throw unavailable();
      const config = structuredClone(await wait(this.integrations.runtimeConfig('file', ref.tenantId, 's3_compatible')));
      if (!config) throw unavailable();
      const request = s3ObjectReadRequest(config, asset.storageKey, this.clock());
      const url = await wait(this.egress(request.url, '知识正文对象地址', { allowQuery: false }));
      if (control.signal.aborted) throw unavailable();
      const responseTask = this.transport(url, { method: 'GET', headers: request.headers, redirect: 'error', signal: control.signal });
      void responseTask.then(response => { if (control.signal.aborted && response.body) void response.body.cancel().catch(() => undefined); }, () => undefined);
      const response = await wait(responseTask);
      const mediaType = (response.headers.get('content-type') ?? '').trim().toLowerCase();
      if (!response.ok || !response.body || !/^(text\/plain|text\/markdown)(?:;\s*charset=utf-8)?$/u.test(mediaType)
        || mediaType.split(';', 1)[0] !== asset.mimeType.split(';', 1)[0].trim().toLowerCase()
        || response.headers.get('content-length') !== String(asset.sizeBytes)) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw unavailable();
      }
      reader = response.body.getReader();
      const chunks: Buffer[] = []; let total = 0;
      for (;;) {
        const next = await wait(reader.read());
        if (control.signal.aborted) throw unavailable();
        if (next.done) break;
        if (!(next.value instanceof Uint8Array) || (total += next.value.byteLength) > Math.min(asset.sizeBytes, maxBytes)) throw unavailable();
        chunks.push(Buffer.from(next.value));
      }
      if (total !== asset.sizeBytes) throw unavailable();
      const latest = await wait(load()), currentHead = await wait(document());
      const currentConfig = await wait(this.integrations.runtimeConfig('file', ref.tenantId, 's3_compatible'));
      if (JSON.stringify(asset) !== JSON.stringify(latest) || JSON.stringify(head) !== JSON.stringify(currentHead)
        || JSON.stringify(config) !== JSON.stringify(currentConfig) || control.signal.aborted) throw unavailable();
      const bytes = Buffer.concat(chunks, total);
      return { mediaType, bytes, contentHash: createHash('sha256').update(bytes).digest('hex') };
    } finally {
      control.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    }
  }
}
