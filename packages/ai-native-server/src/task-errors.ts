/** 原 Task 仓储错误单一身份；兼容宿主和独立参加者共用，保留原 code/name。 */
export class AiTaskRepositoryError extends Error {
  constructor(readonly code: "AI_INVALID_INPUT" | "AI_ACCESS_DENIED" | "AI_RESOURCE_UNAVAILABLE" | "AI_REVISION_CONFLICT" | "AI_STORAGE_UNAVAILABLE") {
    super(code);
    this.name = "AiTaskRepositoryError";
  }
}
