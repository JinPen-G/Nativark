import type {
  AiExecutionContext, AiExecutionScope, AiKnowledgeDocumentDraft, AiKnowledgeChunkDraft,
  AiKnowledgeOwnerDraft, AiFactReference, AiKnowledgeSourceDraft,
} from '@rental-os/shared';

export type KnowledgeAction = 'create' | 'read_metadata' | 'parse' | 'publish' | 'withdraw' | 'delete' | 'revise' | 'search' | 'read_body' | 'snippet' | 'resolve_source' | 'download' | 'index' | 'change_acl';
export interface KnowledgeAuthorizationRequest {
  action: KnowledgeAction;
  scope: AiExecutionScope;
  document?: AiKnowledgeDocumentDraft;
  attachmentId?: string;
  aclRevision?: number;
  fact?: AiFactReference;
}
export interface KnowledgeGrant {
  scope: AiExecutionScope;
  actor: AiKnowledgeOwnerDraft;
  audience: AiExecutionContext['audience'];
  /** Changes with membership, field visibility, location scope and identity policy. Never a bearer token. */
  accessKey: string;
}
export interface KnowledgeAuthorizationPort {
  /** Re-resolve the principal from the server session; reject forged/stale context and check the resource on every call. */
  authorize(context: AiExecutionContext, request: KnowledgeAuthorizationRequest): Promise<KnowledgeGrant | null>;
}
export interface KnowledgeClock { now(): number }
export interface KnowledgeOperation { id: string; fingerprint: string; failure?: KnowledgeRecord['failure'] }
export interface KnowledgeIndexJob {
  operationId: string; documentVersion: string; aclRevision: number; generation: number;
  kind: 'upsert' | 'remove'; status: 'pending' | 'completed' | 'failed';
}
export interface KnowledgeIndexPort {
  /** Idempotent operationId + monotonic generation per scope/document; reject old upsert after a newer remove, also at external commit time. */
  apply(context: AiExecutionContext, input: { scope: AiExecutionScope; documentId: string; job: KnowledgeIndexJob }): Promise<void>;
}
export interface KnowledgeInvalidationPort { invalidate(scope: AiExecutionScope, documentId: string): void }
export interface KnowledgeRecord {
  indexJob?: KnowledgeIndexJob;
  document: AiKnowledgeDocumentDraft;
  revision: number;
  parseOperationId?: string;
  failure?: 'parse_failed' | 'unsupported' | 'invalid_text' | 'empty_text' | 'limit_exceeded' | 'index_failed';
}
export interface KnowledgeRepositoryPort {
  read(scope: AiExecutionScope, documentId: string): Promise<KnowledgeRecord | null>;
  operation(scope: AiExecutionScope, documentId: string, operationId: string): Promise<KnowledgeOperation | null>;
  /** Atomically CAS head, persist operation and immutable version/chunks; unique(scope,id,version) and unique(scope,id,operation). Retain history, never physically delete. */
  commit(input: {
    scope: AiExecutionScope; documentId: string; expectedRevision: number;
    operation: KnowledgeOperation; next: KnowledgeRecord; chunks?: AiKnowledgeChunkDraft[];
    newVersion: boolean;
  }): Promise<'committed' | 'conflict'>;
}
export interface KnowledgeFilePort {
  /** Only authorized attachment references; enforce maxBytes while reading, not after unbounded allocation. */
  read(context: AiExecutionContext, document: AiKnowledgeDocumentDraft, maxBytes: number): Promise<{ mediaType: string; bytes: Uint8Array }>;
}
export interface KnowledgeParserPort {
  parse(document: AiKnowledgeDocumentDraft, file: { mediaType: string; bytes: Uint8Array }): AiKnowledgeChunkDraft[];
}
export type KnowledgeDocumentConstraint = Pick<AiKnowledgeDocumentDraft, 'documentId' | 'documentVersion' | 'aclRevision'>;
export interface KnowledgeSearchAuthorizationPort {
  /** Enumerate only currently permitted versions, at most 100; missing workspace is denial, never a default. */
  select(context: AiExecutionContext): Promise<{ grant: KnowledgeGrant; documents: KnowledgeDocumentConstraint[] } | null>;
}
export interface KnowledgeSearchPort {
  /** Apply every supplied scope/identity/version/ACL constraint before searching; return references only, no text/counts from outside it. */
  search(input: { grant: KnowledgeGrant; documents: KnowledgeDocumentConstraint[]; query: string; limit: number }): Promise<Array<Extract<AiKnowledgeSourceDraft, { kind: 'document' }>>>;
}
export interface KnowledgeContentPort {
  chunk(context: AiExecutionContext, source: Extract<AiKnowledgeSourceDraft, { kind: 'document' }>, maxChars: number): Promise<AiKnowledgeChunkDraft | null>;
  /** Reference only; the eventual download endpoint must reauthorize, not mint a bearer URL here. */
  downloadReference(context: AiExecutionContext, document: AiKnowledgeDocumentDraft): Promise<{ attachmentId: string; documentVersion: string } | null>;
  factReference(context: AiExecutionContext, fact: AiFactReference): Promise<AiFactReference | null>;
}
export interface KnowledgeDocumentPorts {
  cache?: KnowledgeInvalidationPort;
  repository: KnowledgeRepositoryPort;
  authorization: KnowledgeAuthorizationPort;
  clock: KnowledgeClock;
  files: KnowledgeFilePort;
  parser: KnowledgeParserPort;
}
