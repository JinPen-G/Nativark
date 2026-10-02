import type { AiExecutionScope, AiExecutionContext, AiFactReference } from "./ai-native";
export const AI_KNOWLEDGE_DRAFT_VERSION = "ain-c06-draft-1" as const;
export interface AiKnowledgeOwnerDraft { actorKind: AiExecutionContext["actor"]["kind"]; actorId: string }
export interface AiKnowledgeDocumentDraft {
  draftVersion: typeof AI_KNOWLEDGE_DRAFT_VERSION;
  documentId: string; documentVersion: string; attachmentId: string; owner: AiKnowledgeOwnerDraft;
  scope: AiExecutionScope; aclRevision: number; title: string;
  publication: "draft" | "published" | "withdrawn" | "deleted";
  parsing: "pending" | "parsed" | "failed" | "rejected";
  indexing: "not_indexed" | "indexing" | "indexed" | "failed";
  validFrom: string; validUntil?: string;
}
export type AiKnowledgeLocatorDraft = { kind: "page"; page: number; paragraph: number } | { kind: "section"; sectionId: string; paragraph: number };
export interface AiKnowledgeChunkDraft {
  draftVersion: typeof AI_KNOWLEDGE_DRAFT_VERSION;
  documentId: string; documentVersion: string; chunkId: string;
  scope: AiExecutionScope; aclRevision: number; locator: AiKnowledgeLocatorDraft;
  text: string; trust: "untrusted_data";
}
/** Resource ID is not access authority. Business facts cannot become SOP facts. */
export type AiKnowledgeSourceDraft =
  | { kind: "document"; documentId: string; documentVersion: string; chunkId: string; scope: AiExecutionScope; aclRevision: number; locator: AiKnowledgeLocatorDraft }
  | { kind: "business_fact"; fact: AiFactReference };
export type AiKnowledgeRecallDraft = { draftVersion: typeof AI_KNOWLEDGE_DRAFT_VERSION; requestId: string } & (
  | { status: "ready"; matches: Array<{ source: AiKnowledgeSourceDraft; excerpt: string; trust: "untrusted_data" }> }
  | { status: "no_results" }
  | { status: "not_ready"; reason: "not_indexed" | "parsing" }
  | { status: "failed"; reason: "parse_failed" | "index_failed" }
  /** Generic non-disclosure: do not expose existence/IDs/titles to unauthorized callers. */
  | { status: "unavailable"; nextAction: "reauthorize_or_manual" }
);
export type AiPreferenceValueDraft =
  | { kind: "locale"; value: "zh-CN" | "en-US" }
  | { kind: "fulfillment_location"; locationId: string }
  | { kind: "display_density"; value: "comfortable" | "compact" };
interface AiMemoryBaseDraft {
  draftVersion: typeof AI_KNOWLEDGE_DRAFT_VERSION; memoryId: string; revision: number;
  owner: AiKnowledgeOwnerDraft; scope: AiExecutionScope; aclRevision: number;
  expiresAt: string;
}
export type AiMemoryDraft = AiMemoryBaseDraft & (
  | { status: "proposed"; preference: AiPreferenceValueDraft }
  /** Server record reference, not confirmation supplied by the model or permanent authority. */
  | { status: "confirmed"; preference: AiPreferenceValueDraft; confirmationRecordId: string }
  | { status: "deleted"; deletedAt: string }
);
export type AiMemoryChangeDraft = {
  draftVersion: typeof AI_KNOWLEDGE_DRAFT_VERSION; memoryId: string; expectedRevision: number;
} & (
  | { operation: "propose" | "modify"; preference: AiPreferenceValueDraft }
  | { operation: "confirm"; confirmationRecordId: string }
  | { operation: "delete" }
);
