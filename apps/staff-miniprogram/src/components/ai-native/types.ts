export type AiTaskStatus = "registered" | "running" | "waiting" | "partial" | "succeeded" | "cancel_requested" | "cancelled" | "unknown" | "failed";
export interface AiTaskCardModel { id: string; title: string; status: AiTaskStatus | string; statusLabel: string; updatedLabel: string; summary?: string; availabilityLabel: string; manualExitLabel?: string; partial: boolean; }
export interface AiStepModel { id: string; ordinal: number; status: string; label: string; sourceLabel: string; }
export interface AiReadContext { audience: string; tenantId: string; workspaceId?: string; taskId?: string; }
export interface AiInputField { key: string; label: string; value?: string; error?: string; required?: boolean; readonly?: boolean; }
export const AI_NATIVE_COMPONENTS = Object.freeze(["ai-task-card", "ai-step-timeline", "ai-supplement-input", "ai-proposal-confirm", "ai-knowledge-source", "ai-status-panel"] as const);
