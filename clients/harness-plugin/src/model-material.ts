/** Rental-session model-material admission at the original LlmRuntime waterfall, not provider-wire enforcement. */
import type LlmRuntime from "@deepseek-ai/dsh-llm";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { LlmError } from "@deepseek-ai/dsh-llm";

/** Recognize logged Rental guidance, selections and tool records; never infer current authorization. */
export function hasRentalMaterial(options: GenerateOptions): boolean {
  const rentalName = (name: string) => name.startsWith("mcp__rental_os__");
  // Automatic sections become ordinary system messages in the Host log. The
  // server's version marker only retains a size check; copied text grants no access.
  const guidance = (text: string) => /(?:^|\n)Rental OS guidance \([A-Za-z0-9._-]{1,64}\)\n/.test(text);
  return options.system !== undefined && guidance(options.system)
    || options.messages.some(message => message.role === "system" && message.content.some(block => block.type === "text" && guidance(block.text)))
    || options.messages.some(message => message.source?.kind === "rental-prompt" || message.source?.kind === "rental-resource")
    || options.tools?.some(tool => rentalName(tool.name)) === true
    || options.toolHistory?.tools.some(tool => rentalName(tool.name)) === true
    || options.toolHistory?.updates.some(update => update.additions.some(tool => rentalName(tool.name))) === true
    || options.messages.some(message => message.content.some(block =>
      block.type === "tool-call" ? rentalName(block.name)
        : block.type === "tool-addition" || block.type === "tool-removal" ? rentalName(block.toolName) : false));
}

/**
 * Bound the original neutral request and its file-handle projection, without changing input or logs.
 * @param options - Complete original request; cancellation state is excluded from byte accounting.
 * @param failure - Localized rejection text, with no request data or resolver error details.
 * @param fileRequestText - Original LlmRuntime.fileRequestText, bound to the current runtime; not a path resolver.
 * @throws LlmError when either full representation exceeds 256 KiB, or accounting/resolution fails.
 */
export function admitModelMaterial(
  options: GenerateOptions,
  failure: string,
  fileRequestText: LlmRuntime["fileRequestText"],
): void {
  try {
    // Cancellation is control state, not serializable model material. Include
    // every remaining request field, including tools/history/system and repeats.
    const { signal: _signal, ...material } = options;
    if (Buffer.byteLength(JSON.stringify(material), "utf8") > 262_144) throw new Error("oversized");
    if (!material.messages.some(message => message.content.some(block => block.type === "file"))) return;
    // The runtime resolves handle text without reading file contents. Resolve each
    // occurrence, never deduplicate references; keep this projection accounting-only.
    const messages = material.messages.map(message => ({
      ...message,
      content: message.content.map(block => block.type === "file"
        ? { type: "text" as const, text: fileRequestText(block.attachment) } : block),
    }));
    if (Buffer.byteLength(JSON.stringify({ ...material, messages }), "utf8") > 262_144) throw new Error("oversized");
  } catch {
    throw new LlmError(failure, "RENTAL_MATERIAL_UNAVAILABLE");
  }
}
