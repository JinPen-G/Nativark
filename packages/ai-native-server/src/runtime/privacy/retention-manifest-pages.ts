import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';

const unavailable = () => Error('AI_RETENTION_RESTORE_UNAVAILABLE');
const pageSize = 250;
const envelope = z.object({ payload: z.string().max(262144), signature: z.string().max(128), pages: z.array(z.string().max(262144)).max(4096).optional() }).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const header = z.object({ format: z.literal('ai-retention-pages-2'), manifest: z.record(z.unknown()), count: z.number().int().positive(),
  pageHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(4096) }).strict();

export function signManifestPages<T>(manifest: { tombstones: T[] } & Record<string, unknown>, key: KeyObject) {
  const { tombstones, ...metadata } = manifest;
  const pages: string[] = [];
  let payload = JSON.stringify(manifest);
  if (tombstones.length > 500 || Buffer.byteLength(payload) > 262144) {
    for (let offset = 0; offset < tombstones.length; offset += pageSize) {
      const page = JSON.stringify(tombstones.slice(offset, offset + pageSize));
      if (Buffer.byteLength(page) > 262144) throw unavailable();
      pages.push(page);
    }
    payload = JSON.stringify(header.parse({ format: 'ai-retention-pages-2', manifest: metadata, count: tombstones.length, pageHashes: pages.map(digest) }));
  }
  if (Buffer.byteLength(payload) > 262144) throw unavailable();
  return { payload, signature: sign(null, Buffer.from(payload), key).toString('base64'), ...(pages.length ? { pages } : {}) };
}

export function verifyManifestPages(value: unknown, key: string | KeyObject): unknown {
  const signed = envelope.parse(value), signature = Buffer.from(signed.signature, 'base64');
  if (signature.toString('base64') !== signed.signature || Buffer.byteLength(signed.payload) > 262144
    || !verify(null, Buffer.from(signed.payload), key, signature)) throw unavailable();
  const root = JSON.parse(signed.payload);
  if (!signed.pages) {
    if (!Array.isArray(root?.tombstones) || root.tombstones.length > 500) throw unavailable();
    return root;
  }
  const index = header.parse(root);
  if (index.pageHashes.length !== signed.pages.length || Math.ceil(index.count / pageSize) !== signed.pages.length || 'tombstones' in index.manifest) throw unavailable();
  const tombstones = signed.pages.flatMap((page, offset) => {
    if (Buffer.byteLength(page) > 262144 || digest(page) !== index.pageHashes[offset]) throw unavailable();
    const rows: unknown = JSON.parse(page);
    if (!Array.isArray(rows) || rows.length !== Math.min(pageSize, index.count - offset * pageSize)) throw unavailable();
    return rows;
  });
  return { ...index.manifest, tombstones };
}
