'use strict';
const { validateScenario } = require('./loader.cjs');
const document = Object.freeze({ draftVersion: 'ain-c06-draft-1', documentId: 'synthetic_document_1', documentVersion: 'synthetic_v1', attachmentId: 'synthetic_attachment_1', title: 'Synthetic SOP', publication: 'published', parsing: 'parsed', indexing: 'indexed', scope: { kind: 'tenant', id: 'synthetic_tenant_1' }, aclRevision: 1 });
const chunk = Object.freeze({ documentId: document.documentId, documentVersion: document.documentVersion, chunkId: 'synthetic_chunk_1', text: 'Untrusted synthetic SOP text', trust: 'untrusted_data' });
const scenarios = Object.freeze([
  ['published', 'published'], ['withdrawn', 'withdrawn'], ['acl_narrowed', 'acl_narrowed'], ['expired', 'expired'],
].map(([code, expected]) => validateScenario({ code: `knowledge.${code}`, synthetic: true, actor: { kind: 'client', id: 'synthetic_client_1' }, scope: { kind: 'tenant', id: 'synthetic_tenant_1' }, inputRefs: ['synthetic_document_1', 'synthetic_chunk_1'], expected })));
module.exports = Object.freeze({ document, chunk, scenarios });
