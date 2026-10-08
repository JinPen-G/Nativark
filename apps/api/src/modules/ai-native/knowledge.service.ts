import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { KnowledgeDocument, KnowledgeRepository } from './knowledge.ports';
export class KnowledgeService {
  constructor(private readonly repository: KnowledgeRepository) {}
  async create(scope: AiProfileScope, title: string, contentHash: string, chunks: readonly string[]): Promise<KnowledgeDocument> { if (!scope.tenantId || !scope.workspaceId || !title.trim() || !contentHash || chunks.length < 1 || chunks.length > 10_000 || chunks.some(chunk => !chunk || chunk.length > 64_000)) throw new ModelGatewayError('INVALID_REQUEST'); return this.repository.create({ scope, title: title.trim(), contentHash, chunks }); }
  async withdraw(scope: AiProfileScope, documentId: string, expectedRevision: number) { const result = await this.repository.withdraw(scope, documentId, expectedRevision); if (!result) throw new ModelGatewayError('CONFIG_INVALID'); return result; }
  async search(scope: AiProfileScope, actorId: string, query: string, limit = 20) { if (!scope.tenantId || !scope.workspaceId || !actorId || !query.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new ModelGatewayError('INVALID_REQUEST'); return this.repository.search(scope, actorId, query.trim(), limit); }
}
