import { AI_KNOWLEDGE_DRAFT_VERSION } from "./ai-knowledge-draft";
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as int, leafList as list, leafText as text, leafTime as time, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const v = choice(AI_KNOWLEDGE_DRAFT_VERSION), scope = ref("AiExecutionScope");
const owner = obj({ actorKind: choice("user", "saas_admin", "customer", "automation"), actorId: id() });
const locator = { oneOf: [obj({ kind: choice("page"), page: int(1, 100000), paragraph: int(1, 100000) }), obj({ kind: choice("section"), sectionId: id(), paragraph: int(1, 100000) })] };
const preference = { oneOf: [obj({ kind: choice("locale"), value: choice("zh-CN", "en-US") }), obj({ kind: choice("fulfillment_location"), locationId: id() }), obj({ kind: choice("display_density"), value: choice("comfortable", "compact") })] };
const recall = { draftVersion: v, requestId: id() }, change = { draftVersion: v, memoryId: id(), expectedRevision: int() };
const memory = { draftVersion: v, memoryId: id(), revision: int(1), owner, scope, aclRevision: int(1), expiresAt: time };
export const AI_KNOWLEDGE_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiKnowledgeOwnerDraft: owner, AiKnowledgeLocatorDraft: locator,
  AiKnowledgeDocumentDraft: obj({ draftVersion: v, documentId: id(), documentVersion: id(), attachmentId: id(), owner, scope, aclRevision: int(1), title: text(256), publication: choice("draft", "published", "withdrawn", "deleted"), parsing: choice("pending", "parsed", "failed", "rejected"), indexing: choice("not_indexed", "indexing", "indexed", "failed"), validFrom: time, validUntil: time }, ["draftVersion", "documentId", "documentVersion", "attachmentId", "owner", "scope", "aclRevision", "title", "publication", "parsing", "indexing", "validFrom"]),
  AiKnowledgeChunkDraft: obj({ draftVersion: v, documentId: id(), documentVersion: id(), chunkId: id(), scope, aclRevision: int(1), locator, text: text(16000), trust: choice("untrusted_data") }),
  AiKnowledgeSourceDraft: { oneOf: [obj({ kind: choice("document"), documentId: id(), documentVersion: id(), chunkId: id(), scope, aclRevision: int(1), locator }), obj({ kind: choice("business_fact"), fact: ref("AiFactReference") })] },
  AiKnowledgeRecallDraft: { oneOf: [obj({ ...recall, status: choice("ready"), matches: list(obj({ source: ref("AiKnowledgeSourceDraft"), excerpt: text(2000), trust: choice("untrusted_data") }), 20, 1) }), obj({ ...recall, status: choice("no_results") }), obj({ ...recall, status: choice("not_ready"), reason: choice("not_indexed", "parsing") }), obj({ ...recall, status: choice("failed"), reason: choice("parse_failed", "index_failed") }), obj({ ...recall, status: choice("unavailable"), nextAction: choice("reauthorize_or_manual") })] },
  AiPreferenceValueDraft: preference,
  AiMemoryDraft: { oneOf: [obj({ ...memory, status: choice("proposed"), preference }), obj({ ...memory, status: choice("confirmed"), preference, confirmationRecordId: id() }), obj({ ...memory, status: choice("deleted"), deletedAt: time })] },
  AiMemoryChangeDraft: { oneOf: [obj({ ...change, operation: choice("propose", "modify"), preference }), obj({ ...change, operation: choice("confirm"), confirmationRecordId: id() }), obj({ ...change, operation: choice("delete") })] }
};
