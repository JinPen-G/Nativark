import { createHash } from 'node:crypto';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import type { GatewayMediaAttachmentResolver } from './gateway-intent';

export interface GatewayMediaAttachmentReference {
  kind: 'image' | 'audio';
  attachmentId: string;
  attachmentRevision: number;
}

/** The authority must perform the current request-bound identity, tenant/workspace,
 * object ownership, active revision and media capability checks. A reference from
 * the Agent is never an authorization grant. */
export interface GatewayAuthorizedMediaAttachment {
  attachmentId: string;
  attachmentRevision: number;
  mediaType: 'image/png' | 'image/jpeg' | 'audio/wav';
  sizeBytes: number;
  contentHash: string;
  readBinding: unknown;
}

export interface GatewayMediaAttachmentAuthority {
  authorize(context: GatewayContext, reference: GatewayMediaAttachmentReference, signal: AbortSignal): Promise<GatewayAuthorizedMediaAttachment | null>;
}

/** Reads bytes only from a server-created, authority-bound binding. It must not
 * accept an attachment id, URL, storage key or credential from the Agent. */
export interface GatewayMediaAttachmentBytesReader {
  read(binding: GatewayAuthorizedMediaAttachment, signal: AbortSignal): Promise<Uint8Array>;
}

/** Composition adapter for the public Gateway media port. Storage/ACL policy is
 * supplied by the host; missing or inconsistent evidence fails closed. */
export class AuthorizedGatewayMediaAttachmentResolver implements GatewayMediaAttachmentResolver {
  async assertCurrent(context: GatewayContext, references: Parameters<NonNullable<GatewayMediaAttachmentResolver['assertCurrent']>>[1], signal: AbortSignal) {
    context = structuredClone(context); references = structuredClone(references);
    if (references.length < 1 || references.length > 8) throw new ModelGatewayError('INVALID_REQUEST');
    for (const reference of references) {
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      const current = await this.authority.authorize(structuredClone(context), {
        kind: reference.kind, attachmentId: reference.attachmentId, attachmentRevision: reference.attachmentRevision
      }, signal);
      if (!current || current.attachmentId !== reference.attachmentId || current.attachmentRevision !== reference.attachmentRevision
        || current.contentHash !== reference.contentHash || current.mediaType !== reference.mediaType
        || current.sizeBytes < 1 || current.sizeBytes > this.maxBytes) throw new ModelGatewayError('FORBIDDEN');
    }
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
  }
  constructor(
    private readonly authority: GatewayMediaAttachmentAuthority,
    private readonly reader: GatewayMediaAttachmentBytesReader,
    private readonly maxBytes = 524288
  ) {
    if (typeof authority?.authorize !== 'function' || typeof reader?.read !== 'function'
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 524288) throw new ModelGatewayError('CONFIG_INVALID');
  }

  async resolve(context: GatewayContext, reference: GatewayMediaAttachmentReference, signal: AbortSignal) {
    context = structuredClone(context); reference = structuredClone(reference);
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
    let grant: GatewayAuthorizedMediaAttachment | null;
    try { grant = await this.authority.authorize(structuredClone(context), structuredClone(reference), signal); }
    catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('CAPABILITY_UNSUPPORTED'); }
    grant = grant && structuredClone(grant);
    if (!grant || grant.attachmentId !== reference.attachmentId || grant.attachmentRevision !== reference.attachmentRevision
      || !Number.isSafeInteger(grant.sizeBytes) || grant.sizeBytes < 1 || grant.sizeBytes > this.maxBytes
      || !/^[a-f0-9]{64}$/u.test(grant.contentHash)) return null;
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
    let bytes: Uint8Array;
    try { bytes = await this.reader.read(structuredClone(grant), signal); }
    catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('CAPABILITY_UNSUPPORTED'); }
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== grant.sizeBytes
      || createHash('sha256').update(bytes).digest('hex') !== grant.contentHash) return null;
    bytes = new Uint8Array(bytes);
    // Storage may wait while ownership, revision or ACL is revoked. Recheck
    // the same server binding, never release bytes on the initial grant alone.
    const current = await this.authority.authorize(structuredClone(context), structuredClone(reference), signal);
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
    if (!current || current.attachmentId !== grant.attachmentId || current.attachmentRevision !== grant.attachmentRevision
      || current.mediaType !== grant.mediaType || current.sizeBytes !== grant.sizeBytes || current.contentHash !== grant.contentHash) return null;
    return { attachmentId: grant.attachmentId, attachmentRevision: grant.attachmentRevision,
      mediaType: grant.mediaType, bytes: new Uint8Array(bytes), contentHash: grant.contentHash };
  }
}
