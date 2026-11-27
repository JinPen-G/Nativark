/** Original public work-center conversation result on its own locator. */
import { createWorkCenterOriginalRead, type WorkCenterOriginalReadBinding } from "./work-center-read.js";

export type ConversationResultReadBinding = WorkCenterOriginalReadBinding;
export function createConversationResultRead(binding: ConversationResultReadBinding) {
  return createWorkCenterOriginalRead("conversationResult", binding);
}
