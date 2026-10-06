import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeAuthorizationPort, KnowledgeDocumentConstraint, KnowledgeRepositoryPort, KnowledgeSearchAuthorizationPort } from './knowledge.ports';
import { requiredPort, unavailable } from './knowledge-errors';
import { authorize, fingerprint, id, sameScope } from './knowledge-validation';

/** Workspace metadata only. The supplied current authorization remains the ACL
 * authority; this adapter neither interprets ACL strings nor grants permission.
 * More than 100 candidates is unavailable, not a silently complete truncated set.
 */
export class PrismaKnowledgeSelectionAdapter implements KnowledgeSearchAuthorizationPort {
  constructor(
    private readonly db: Pick<PrismaClient, 'aiKnowledgeDocument'>,
    private readonly repository: KnowledgeRepositoryPort,
    private readonly authorization: KnowledgeAuthorizationPort,
  ) {
    requiredPort(db?.aiKnowledgeDocument, ['findMany']);
    requiredPort(repository, ['read']); requiredPort(authorization, ['authorize']);
  }

  async select(context: AiExecutionContext) {
    try {
      const initial = fingerprint(context), snapshot = structuredClone(context);
      const current = () => { if (fingerprint(context) !== initial || fingerprint(snapshot) !== initial) unavailable(); };
      if (snapshot.scope.kind !== 'workspace') return null;
      const scope = snapshot.scope;
      const grant = structuredClone(await authorize(this.authorization, snapshot, { action: 'search', scope }));
      current();
      const rows = await this.db.aiKnowledgeDocument.findMany({
        where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId, status: 'published' },
        orderBy: { id: 'asc' }, take: 101,
        select: { id: true, tenantId: true, workspaceId: true, status: true },
      });
      current();
      if (!Array.isArray(rows) || rows.length > 100) unavailable();
      const seen = new Set<string>();
      const documents: KnowledgeDocumentConstraint[] = [];
      for (const row of rows) {
        if (!id.safeParse(row.id).success || seen.has(row.id) || row.tenantId !== scope.tenantId
          || row.workspaceId !== scope.workspaceId || row.status !== 'published') unavailable();
        seen.add(row.id);
        const head = await this.repository.read(scope, row.id);
        current();
        if (!head || !sameScope(head.document.scope, scope) || head.document.documentId !== row.id) unavailable();
        if (head.document.publication !== 'published') unavailable();
        const before = fingerprint(head);
        const request = { action: 'search' as const, scope, document: structuredClone(head.document), aclRevision: head.document.aclRevision };
        const allowed = await this.authorization.authorize(snapshot, request);
        current();
        if (fingerprint(head) !== before || fingerprint(request.document) !== fingerprint(head.document)) unavailable();
        if (!allowed) continue;
        const checked = await authorize({ authorize: async () => allowed }, snapshot, request);
        if (fingerprint(checked) !== fingerprint(grant)) unavailable();
        const fresh = await this.repository.read(scope, row.id);
        current();
        if (!fresh || fingerprint(fresh) !== before) unavailable();
        documents.push({ documentId: row.id, documentVersion: fresh.document.documentVersion, aclRevision: fresh.document.aclRevision });
      }
      const latest = await authorize(this.authorization, snapshot, { action: 'search', scope });
      current();
      if (fingerprint(latest) !== fingerprint(grant)) unavailable();
      return { grant, documents };
    } catch { return unavailable(); }
  }
}
