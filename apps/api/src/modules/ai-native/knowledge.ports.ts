import type { AiProfileScope } from './provider-profile.ports';
export interface KnowledgeDocument { id: string; scope: AiProfileScope; title: string; status: 'active' | 'withdrawn'; revision: number; withdrawnAt: Date | null; }
export interface KnowledgeChunk { documentId: string; version: number; chunkIndex: number; text: string; score: number; }
export interface KnowledgeRepository {
  create(input: { scope: AiProfileScope; title: string; contentHash: string; chunks: readonly string[] }): Promise<KnowledgeDocument>;
  withdraw(scope: AiProfileScope, documentId: string, expectedRevision: number): Promise<KnowledgeDocument | null>;
  search(scope: AiProfileScope, actorId: string, query: string, limit: number): Promise<KnowledgeChunk[]>;
}
