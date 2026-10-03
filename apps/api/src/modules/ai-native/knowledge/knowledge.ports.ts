import type {
  AiExecutionContext, AiExecutionScope, AiKnowledgeDocumentDraft, AiKnowledgeChunkDraft,
  AiKnowledgeOwnerDraft, AiFactReference,
} from '@rental-os/shared';

export type KnowledgeAction = 'create' | 'read_metadata' | 'parse' | 'publish' | 'withdraw' | 'delete' | 'revise' | 'search' | 'read_body' | 'snippet' | 'resolve_source' | 'download' | 'index' | 'change_acl';
export interface KnowledgeAuthorizationRequest {
  action: KnowledgeAction;
  scope: AiExecutionScope;
  document?: AiKnowledgeDocumentDraft;
  attachmentId?: string;
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
export interface KnowledgeOperation { id: string; fingerprint: string }
export interface KnowledgeRecord {
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
export interface KnowledgeDocumentPorts {
  repository: KnowledgeRepositoryPort;
  authorization: KnowledgeAuthorizationPort;
  clock: KnowledgeClock;
  files: KnowledgeFilePort;
  parser: KnowledgeParserPort;
}
