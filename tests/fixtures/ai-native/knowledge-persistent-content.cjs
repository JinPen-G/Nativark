'use strict';
// Only Prisma execution is substituted; lifecycle, repository, authorization
// consumers and retrieval are real product classes. No network or clock work.
exports.dbFactory = function dbFactory() {
  const state = { documents: new Map(), versions: new Map(), chunks: new Map(), operations: new Map(), memories: new Map(), memoryOperations: new Map(), confirmations: new Map(), erasures: new Map() };
  const clone = value => structuredClone(value);
  const db = { state, queries: [], afterRead: null, responseError: null, failReceipt: false };
  db.aiKnowledgeDocument = {
    async findFirst({ where, include }) {
      const row = [...state.documents.values()].find(v => Object.entries(where).every(([k, value]) => v[k] === value));
      if (!row) return null; const out = clone(row);
      if (include?.versions) out.versions = [...state.versions.values()].filter(v => v.documentId === row.id).sort((a, b) => b.version - a.version).slice(0, include.versions.take);
      return out;
    },
    async create({ data }) { if (state.documents.has(data.id)) throw new Error('duplicate'); const row = { createdAt: new Date('2026-10-03T00:00:00Z'), ...clone(data) }; state.documents.set(data.id, row); return clone(row); },
    async updateMany({ where, data }) { const row = state.documents.get(where.id); if (!row || !Object.entries(where).every(([k, value]) => row[k] === value)) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; }
  };
  db.aiKnowledgeVersion = {
    async findFirst({ where }) { return clone([...state.versions.values()].find(v => Object.entries(where).every(([k, value]) => v[k] === value)) ?? null); },
    async findMany({ where, take, include, select }) {
      return clone([...state.versions.values()].filter(v => {
        const doc = state.documents.get(v.documentId);
        return v.documentId === where.documentId && (!where.contentHash || v.contentHash === where.contentHash)
          && (!where.document || doc && Object.entries(where.document).every(([key, value]) => doc[key] === value));
      }).sort((a, b) => a.version - b.version).slice(0, take).map(v => {
        const chunks = [...state.chunks.values()].filter(c => c.versionId === v.id).sort((a, b) => a.chunkIndex - b.chunkIndex);
        if (select) return Object.fromEntries(Object.keys(select).map(key => [key,
          key === '_count' ? { chunks: chunks.length } : v[key]]));
        return { ...v, chunks: include?.chunks ? chunks.slice(0, include.chunks.take ?? chunks.length) : undefined };
      }));
    },
    async create({ data }) { const { chunks, ...row } = data; state.versions.set(row.id, clone(row)); for (const chunk of chunks?.create ?? []) state.chunks.set(chunk.id, { ...clone(chunk), versionId: row.id }); return clone(row); }
  };
  db.aiKnowledgeChunk = {
    async findFirst({ where }) { return clone([...state.chunks.values()].find(v => Object.entries(where).every(([k, value]) => v[k] === value)) ?? null); },
    async create({ data }) { state.chunks.set(data.id, clone(data)); return clone(data); },
    async findMany({ where, take, orderBy }) {
      db.queries.push({ where: clone(where), take, orderBy });
      const rows = [...state.chunks.values()].filter(row => {
        const version = state.versions.get(row.versionId), doc = version && state.documents.get(version.documentId);
        return doc && Object.entries(where.version.document).every(([k, value]) => doc[k] === value)
          && version.documentId === where.version.documentId && version.contentHash === where.version.contentHash
          && (!where.text || row.text.includes(where.text.contains))
          && (!where.state || (where.state.path === '$.chunkId' && row.state?.chunkId === where.state.equals));
      }).sort((a, b) => a.chunkIndex - b.chunkIndex || a.id.localeCompare(b.id)).slice(0, take);
      const result = clone(rows); if (db.afterRead) db.afterRead(); return result;
    }
  };
  db.aiKnowledgeOperation = {
    async findFirst({ where }) { return clone([...state.operations.values()].find(v => Object.entries(where).every(([k, value]) => v[k] === value)) ?? null); },
    async create({ data }) { if (db.failReceipt) throw new Error('write failed'); state.operations.set(data.id, clone(data)); return clone(data); }
  };
  const memoryDelegate = map => ({
    async findFirst({ where }) { return clone([...map().values()].find(v => Object.entries(where).every(([k, value]) => v[k] === value)) ?? null); },
    async create({ data }) { if (map().has(data.id)) throw new Error('duplicate'); const row = { createdAt: new Date('2026-10-03T00:00:00Z'), ...clone(data) }; map().set(data.id, row); return clone(row); },
    async updateMany({ where, data }) { const row = map().get(where.id); if (!row || !Object.entries(where).every(([k, value]) => row[k] === value)) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; }
  });
  db.aiStructuredMemory = memoryDelegate(() => state.memories);
  db.aiMemoryOperation = memoryDelegate(() => state.memoryOperations);
  db.aiHumanConfirmation = memoryDelegate(() => state.confirmations);
  db.aiDataErasure = {
    async findUnique({ where }) { return clone(state.erasures.get(where.id) ?? null); },
    async upsert({ where, create, update }) {
      const row = state.erasures.get(where.id);
      if (!row) { const value = { revision: 1, createdAt: new Date('2026-10-03T00:00:00Z'), ...clone(create) }; state.erasures.set(where.id, value); return clone(value); }
      for (const [key, value] of Object.entries(update)) row[key] = value && typeof value === 'object' && 'increment' in value
        ? row[key] + value.increment : clone(value);
      return clone(row);
    }
  };
  db.$transaction = async callback => {
    const snapshot = clone(state);
    let result;
    try { result = await callback(db); } catch (error) { Object.assign(state, snapshot); throw error; }
    if (db.responseError) throw db.responseError;
    return result;
  };
  return db;
};
