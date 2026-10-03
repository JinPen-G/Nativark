import type { AiReadContext } from "./types";
export interface AiContextView { key: string; generation: number; visible: boolean; }
const keyOf = (context: AiReadContext): string => [context.audience, context.tenantId, context.workspaceId ?? "", context.taskId ?? ""].join("|");
export class AiContextIsolation {
  private generation = 0; private key = "";
  view(context: AiReadContext): AiContextView { const key = keyOf(context); if (key !== this.key) { this.key = key; this.generation += 1; } return { key, generation: this.generation, visible: false }; }
  accepts(context: AiReadContext, generation: number): boolean { return this.key === keyOf(context) && this.generation === generation; }
  clear() { this.key = ""; this.generation += 1; }
}
