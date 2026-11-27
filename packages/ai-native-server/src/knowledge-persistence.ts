/** Public C06 relational storage, ACL-bound retrieval and original deletion.
 * Source ACL, file binding, deletion propagation and Gateway remain host ports. */
export { KnowledgeModule, composeKnowledgeServices, type KnowledgeModulePorts } from './runtime/knowledge/knowledge.module';
export { createPersistedKnowledgePorts, composePersistedKnowledge, type PersistentKnowledgeDependencies } from './runtime/knowledge/persisted-knowledge';
export { bindPrismaKnowledgeRetention, type KnowledgeSourceRetention } from './runtime/knowledge/knowledge-retention-participant';
export { KnowledgeError, KnowledgeCommitUnknownError } from './runtime/knowledge/knowledge-errors';
export type { KnowledgeAuthorizationPort, KnowledgeFilePort, KnowledgeSearchAuthorizationPort,
  KnowledgeContentPort, KnowledgeGrant, MemoryAuthorizationPort } from './runtime/knowledge/knowledge.ports';
