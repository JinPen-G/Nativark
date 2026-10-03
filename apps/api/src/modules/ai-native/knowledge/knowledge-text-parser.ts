import { TextDecoder } from 'node:util';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiKnowledgeChunkDraft, type AiKnowledgeDocumentDraft } from '@rental-os/shared';
import type { KnowledgeParserPort } from './knowledge.ports';
import { KnowledgeError } from './knowledge-errors';
import { validateChunks } from './knowledge-validation';

export class KnowledgeTextParser implements KnowledgeParserPort {
  parse(document: AiKnowledgeDocumentDraft, file: { mediaType: string; bytes: Uint8Array }): AiKnowledgeChunkDraft[] {
    if (!/^(text\/plain|text\/markdown)(?:;\s*charset=utf-8)?$/i.test(file.mediaType)) throw new KnowledgeError('unsupported');
    if (!(file.bytes instanceof Uint8Array)) throw new KnowledgeError('invalid_text');
    if (file.bytes.byteLength > 262144) throw new KnowledgeError('limit_exceeded');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { throw new KnowledgeError('invalid_text'); }
    if (text.length > 200000) throw new KnowledgeError('limit_exceeded');
    if (!text.trim()) throw new KnowledgeError('empty_text');
    if (text.includes('\0')) throw new KnowledgeError('invalid_text');
    const chunks: AiKnowledgeChunkDraft[] = [];
    let section = 0, paragraph = 0;
    for (const part of text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n/)) {
      if (!part.trim()) continue;
      if (/^#{1,6}[\t ]/m.test(part)) { section++; paragraph = 0; }
      paragraph++;
      let start = 0, piece = 0;
      while (start < part.length) {
        let end = Math.min(start + 2000, part.length);
        if (end < part.length && /[\uD800-\uDBFF]/.test(part[end - 1])) end--;
        const excerpt = part.slice(start, end);
        if (excerpt.trim()) {
          chunks.push({ draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, documentId: document.documentId, documentVersion: document.documentVersion, chunkId: `s${section}-p${paragraph}-c${++piece}`, scope: structuredClone(document.scope), aclRevision: document.aclRevision, locator: { kind: 'section', sectionId: `section-${section}`, paragraph }, text: excerpt, trust: 'untrusted_data' });
          if (chunks.length > 200) throw new KnowledgeError('limit_exceeded');
        }
        start = end;
      }
    }
    validateChunks(document, chunks);
    return chunks;
  }
}
