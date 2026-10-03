import { Module, type DynamicModule } from '@nestjs/common';
import type { AiGatewayPortDraft } from '@rental-os/shared';
import type { KnowledgeDocumentPorts, KnowledgeContentPort, KnowledgeSearchAuthorizationPort, KnowledgeSearchPort, KnowledgeIndexPort, StructuredMemoryPorts } from './knowledge.ports';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgePublicationService } from './knowledge-publication.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeSourceService } from './knowledge-source.service';
import { KnowledgeIndexCoordinator } from './knowledge-index-coordinator';
import { KnowledgeCache } from './knowledge-cache';
import { KnowledgeTextParser } from './knowledge-text-parser';
import { StructuredMemoryService } from './structured-memory.service';
import { KnowledgeGatewayContext } from './knowledge-gateway-context';
import { requiredPort } from './knowledge-errors';

export interface KnowledgeModulePorts {
  documents: Omit<KnowledgeDocumentPorts, 'parser' | 'cache'>;
  content: KnowledgeContentPort; selection: KnowledgeSearchAuthorizationPort; search: KnowledgeSearchPort;
  index: KnowledgeIndexPort; memory: StructuredMemoryPorts; gateway: AiGatewayPortDraft;
  cache: { maxEntries: number; maxBytes: number; ttlMs: number };
  policy: { sceneCode: string; maxOutputTokens: number };
}
const bundleToken = Symbol('knowledge-internal-bundle');
type Bundle = ReturnType<typeof compose>;
function compose(ports: KnowledgeModulePorts) {
  const cache = new KnowledgeCache(ports.documents.clock, ports.cache);
  const documents = new KnowledgeDocumentService({ ...ports.documents, cache, parser: new KnowledgeTextParser() });
  const publication = new KnowledgePublicationService(documents), sources = new KnowledgeSourceService(documents, ports.content, cache);
  const retrieval = new KnowledgeRetrievalService(documents, sources, ports.selection, ports.search);
  const index = new KnowledgeIndexCoordinator(documents, ports.index), memory = new StructuredMemoryService(ports.memory);
  const context = new KnowledgeGatewayContext(retrieval, sources, memory, ports.documents.authorization, ports.gateway, ports.policy);
  return { cache, documents, publication, sources, retrieval, index, memory, context };
}
@Module({})
export class KnowledgeModule {
  static register(ports: KnowledgeModulePorts): DynamicModule {
    requiredPort(ports?.documents?.repository, ['read', 'operation', 'commit']);
    requiredPort(ports?.documents?.authorization, ['authorize']); requiredPort(ports?.documents?.files, ['read']); requiredPort(ports?.documents?.clock, ['now']);
    requiredPort(ports?.content, ['chunk', 'downloadReference', 'factReference']); requiredPort(ports?.selection, ['select']); requiredPort(ports?.search, ['search']); requiredPort(ports?.index, ['apply']);
    requiredPort(ports?.memory?.repository, ['read', 'operation', 'commit']); requiredPort(ports?.memory?.authorization, ['authorize']); requiredPort(ports?.memory?.clock, ['now']); requiredPort(ports?.memory?.confirmations, ['read']); requiredPort(ports?.gateway, ['invoke', 'stream']);
    // No DB, allow-all identity, default model, Controller or worker registration.
    const services = [KnowledgeCache, KnowledgeDocumentService, KnowledgePublicationService, KnowledgeSourceService, KnowledgeRetrievalService, KnowledgeIndexCoordinator, StructuredMemoryService, KnowledgeGatewayContext];
    const keys = ['cache', 'documents', 'publication', 'sources', 'retrieval', 'index', 'memory', 'context'] as const;
    return { module: KnowledgeModule, providers: [{ provide: bundleToken, useFactory: () => compose(ports) },
      ...services.map((service, i) => ({ provide: service, inject: [bundleToken], useFactory: (bundle: Bundle) => bundle[keys[i]] }))], exports: services };
  }
}
