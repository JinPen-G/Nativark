"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require("../apps/api/src/contracts/ai-native-schemas"), { AI_KNOWLEDGE_DRAFT_SCHEMAS: schemas } = require("../packages/shared/src/ai-knowledge-draft-schemas"), f = require("./fixtures/ai-native/knowledge-contracts.cjs");
const validators = h.validatorsFor(schemas, base), yes = (n, x) => assert.equal(validators[n](x), true, JSON.stringify(validators[n].errors)), no = (n, x) => assert.equal(validators[n](x), false, n);
test("C06 closed reference graph has no external URLs or retrieval/ACL implementation", () => h.checkClosed(schemas, { ...base, ...schemas }));
test("documents express every lifecycle/parse/index state without assuming retrieval readiness", () => {
  for (const publication of ["draft", "published", "withdrawn", "deleted"]) yes("AiKnowledgeDocumentDraft", { ...f.document, publication });
  for (const parsing of ["pending", "parsed", "failed", "rejected"]) yes("AiKnowledgeDocumentDraft", { ...f.document, parsing });
  for (const indexing of ["not_indexed", "indexing", "indexed", "failed"]) yes("AiKnowledgeDocumentDraft", { ...f.document, indexing });
  for (const field of ["publication", "parsing", "indexing"]) no("AiKnowledgeDocumentDraft", { ...f.document, [field]: "unknown" });
  no("AiKnowledgeDocumentDraft", { ...f.document, downloadUrl: "https://untrusted.test" });
});
test("source/locator unions preserve business fact basis and exact version references", () => {
  yes("AiKnowledgeSourceDraft", f.source); yes("AiKnowledgeSourceDraft", { kind: "business_fact", fact: h.fact });
  yes("AiKnowledgeLocatorDraft", { kind: "section", sectionId: "section-test", paragraph: 1 });
  no("AiKnowledgeSourceDraft", { ...f.source, documentVersion: undefined });
  no("AiKnowledgeSourceDraft", { kind: "business_fact", documentId: "pretend-sop" });
  no("AiKnowledgeLocatorDraft", { kind: "page", page: 0, paragraph: 1 });
  no("AiKnowledgeLocatorDraft", { kind: "section", paragraph: 1 });
});
for (const recall of f.recalls) test(`C06 recall ${recall.status} has non-disclosing closed shape`, () => {
  yes("AiKnowledgeRecallDraft", recall); no("AiKnowledgeRecallDraft", { ...recall, hiddenDocumentId: "secret" });
  if (recall.status === "unavailable") no("AiKnowledgeRecallDraft", { ...recall, reason: "object_exists_but_forbidden" });
  if (recall.status === "ready") { no("AiKnowledgeRecallDraft", { ...recall, matches: [] }); no("AiKnowledgeRecallDraft", { ...recall, matches: Array(21).fill(recall.matches[0]) }); }
  else no("AiKnowledgeRecallDraft", { ...recall, matches: f.recalls[0].matches });
});
for (const pref of f.preferences) test(`C06 preference ${pref.kind} cannot grant permission`, () => { yes("AiPreferenceValueDraft", pref); no("AiPreferenceValueDraft", { ...pref, permission: "all" }); no("AiPreferenceValueDraft", { ...pref, confirmed: true }); });
for (const change of f.changes) test(`C06 memory ${change.operation} protocol`, () => {
  yes("AiMemoryChangeDraft", change); no("AiMemoryChangeDraft", { ...change, permanentAuthorization: true }); no("AiMemoryChangeDraft", { ...change, expectedRevision: -1 });
  if (change.operation === "confirm") no("AiMemoryChangeDraft", { ...change, confirmationRecordId: undefined });
  if (change.operation === "delete") no("AiMemoryChangeDraft", { ...change, preference: f.preferences[0] });
});
test("C06 version/body/scope bounds and unknown fields reject; text remains untrusted", () => {
  yes("AiKnowledgeChunkDraft", f.chunk); yes("AiMemoryDraft", f.memory);
  no("AiKnowledgeChunkDraft", { ...f.chunk, trust: "system_instruction" }); no("AiKnowledgeChunkDraft", { ...f.chunk, text: "x".repeat(16001) });
  no("AiMemoryDraft", { ...f.memory, status: "approved_to_execute" }); no("AiMemoryDraft", { ...f.memory, draftVersion: "v0" });
  no("AiKnowledgeDocumentDraft", { ...f.document, scope: { kind: "workspace", tenantId: "t" } });
  no("AiKnowledgeDocumentDraft", { ...f.document, aclRevision: 0 });
});
test("C06 confirmed memory needs record reference; deleted tombstone contains no preference", () => {
  yes("AiMemoryDraft", { ...f.memory, status: "confirmed", confirmationRecordId: "confirm-test" });
  no("AiMemoryDraft", { ...f.memory, status: "confirmed" });
  const { preference, ...tombstone } = f.memory;
  yes("AiMemoryDraft", { ...tombstone, status: "deleted", deletedAt: h.time });
  no("AiMemoryDraft", { ...tombstone, status: "deleted", deletedAt: h.time, preference });
});
test("C06 TS all sources/recalls/preferences/changes compile, unauthorized fields reject", () => {
  assert.deepEqual(h.compileConsumer(`import type { AiKnowledgeDocumentDraft, AiKnowledgeChunkDraft, AiKnowledgeSourceDraft, AiKnowledgeRecallDraft, AiMemoryDraft, AiMemoryChangeDraft, AiPreferenceValueDraft } from "../packages/shared/src/ai-knowledge-draft";
const doc: AiKnowledgeDocumentDraft = ${JSON.stringify(f.document)};
const chunk: AiKnowledgeChunkDraft = ${JSON.stringify(f.chunk)};
const sources: AiKnowledgeSourceDraft[] = ${JSON.stringify([f.source, { kind: "business_fact", fact: h.fact }])};
const recalls: AiKnowledgeRecallDraft[] = ${JSON.stringify(f.recalls)};
const prefs: AiPreferenceValueDraft[] = ${JSON.stringify(f.preferences)};
const memory: AiMemoryDraft = ${JSON.stringify(f.memory)};
const confirmed: AiMemoryDraft = { ...memory, status: "confirmed", confirmationRecordId: "confirm-test" };
const deleted: AiMemoryDraft = { draftVersion: "${f.version}", memoryId: "m", revision: 2, owner: memory.owner, scope: memory.scope, aclRevision: 1, expiresAt: "${h.time}", status: "deleted", deletedAt: "${h.time}" };
const changes: AiMemoryChangeDraft[] = ${JSON.stringify(f.changes)};
// @ts-expect-error preference is not execute authority
const auth: AiPreferenceValueDraft = { kind: "permission", value: "all" };
// @ts-expect-error unavailable does not expose source
const hidden: AiKnowledgeRecallDraft = { draftVersion: "${f.version}", requestId: "r", status: "unavailable", nextAction: "reauthorize_or_manual", documentId: "hidden" };
// @ts-expect-error external URL is not source
const url: AiKnowledgeSourceDraft = { kind: "document", url: "https://untrusted.test" };
// @ts-expect-error no confirmed preference without record reference
const missing: AiMemoryDraft = { ...memory, status: "confirmed" };
`), []);
});
