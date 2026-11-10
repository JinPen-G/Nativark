/** In-app conversation locators only. A navigation state cannot authorize a
 * read, start or identity transfer; the original API rechecks every operation. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_CODES, type AiConversationReferenceDraft, type AiSceneCode } from '@rental-os/shared';

export type ConversationSelection = AiConversationReferenceDraft & { capabilityCode: AiSceneCode };
export type ConversationNavigation = ConversationSelection & { identity: string; sessionEpoch: number };

export function readConversationNavigation(value: unknown, identity: string, sessionEpoch: number): ConversationNavigation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = ['draftVersion', 'conversationId', 'capabilityCode', 'identity', 'sessionEpoch'];
  if (Object.keys(row).length !== keys.length || !Object.keys(row).every(key => keys.includes(key))
    || row.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || row.identity !== identity || row.sessionEpoch !== sessionEpoch
    || typeof row.conversationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(row.conversationId)
    || !AI_SCENE_CODES.includes(row.capabilityCode as AiSceneCode)) return null;
  return { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: row.conversationId,
    capabilityCode: row.capabilityCode as AiSceneCode, identity, sessionEpoch };
}
