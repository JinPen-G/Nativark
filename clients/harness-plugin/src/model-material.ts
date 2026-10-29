/** Rental-session model-material admission at the original LlmRuntime waterfall, not provider-wire enforcement. */
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { LlmError } from "@deepseek-ai/dsh-llm";

/** Recognize logged Rental selections and tool records; never infer current authorization. */
export function hasRentalMaterial(options: GenerateOptions): boolean {
  const rentalName = (name: string) => name.startsWith("mcp__rental_os__");
  return options.messages.some(message => message.source?.kind === "rental-prompt")
    || options.tools?.some(tool => rentalName(tool.name)) === true
    || options.toolHistory?.tools.some(tool => rentalName(tool.name)) === true
    || options.toolHistory?.updates.some(update => update.additions.some(tool => rentalName(tool.name))) === true
    || options.messages.some(message => message.content.some(block =>
      block.type === "tool-call" ? rentalName(block.name)
        : block.type === "tool-addition" || block.type === "tool-removal" ? rentalName(block.toolName) : false));
}

/** Read the complete neutral request without truncating or rewriting durable model input. */
export function admitModelMaterial(options: GenerateOptions, failure: string): void {
  try {
    // Cancellation is control state, not serializable model material. Include
    // every remaining request field, including tools/history/system and repeats.
    const { signal: _signal, ...material } = options;
    if (Buffer.byteLength(JSON.stringify(material), "utf8") > 262_144) throw new Error("oversized");
  } catch {
    throw new LlmError(failure, "RENTAL_MATERIAL_UNAVAILABLE");
  }
}
