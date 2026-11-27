/** Four locator-only candidates on the public work-center contract. Constructing
 * these does not publish a tool, accept Web credentials or reconnect a Task. */
import { AI_PUBLIC_WORK_CENTER_ORIGINAL_READS as reads, AI_PUBLIC_WORK_CENTER_SCHEMAS as components } from "@rental-os/platform-contracts/ai-work-center";
import { createClosedOriginalRead, type ClosedOriginalReadBinding } from "./original-read-tool.js";

export type WorkCenterOriginalReadKind = keyof typeof reads;
export type WorkCenterOriginalReadBinding = ClosedOriginalReadBinding<Record<string, unknown>>;

function same(command: Readonly<Record<string, unknown>>, result: Record<string, unknown>, ...keys: string[]) {
  return keys.every(key => result[key] === command[key]);
}

function matches(kind: WorkCenterOriginalReadKind, command: Readonly<Record<string, unknown>>, result: Record<string, unknown>): boolean {
  switch (kind) {
    case "task": return same(command, result, "taskId", "runId");
    case "taskResult": return same(command, result, "taskId", "resultId");
    case "conversation": return same(command, result, "draftVersion", "conversationId");
    case "conversationResult": {
      if (!same(command, result, "draftVersion", "conversationId", "admissionKey")) return false;
      if (result.status === "not_observed") return result.result === null;
      const original = result.result;
      return result.status === "observed" && !!original && typeof original === "object"
        && "resultId" in original && original.resultId === command.resultId;
    }
  }
}

/** `read` must use the original current subject and original object/key reader.
 * Its association proof is still required where the public value omits it. */
export function createWorkCenterOriginalRead(kind: WorkCenterOriginalReadKind, binding: WorkCenterOriginalReadBinding) {
  if (!Object.hasOwn(reads, kind)) throw new TypeError("Original work-center read unavailable");
  const [, , request, response, writes] = reads[kind];
  if (writes !== false) throw new TypeError("Original work-center read unavailable");
  return createClosedOriginalRead<Record<string, unknown>, Record<string, unknown>>(binding, {
    components, request, response, unavailable: "Original work-center read unavailable",
    matches: (command, result) => matches(kind, command, result),
  });
}
