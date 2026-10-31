/** Versioned, approved server guidance; never a data reader or an authorization mechanism. */
import type { McpReadAuthorization } from "./read-tools.js";
import { snapshotJsonFields } from "./json-snapshot.js";

/** Original policy owner releases only current, reviewed external guidance. */
export interface McpInstructionsProvider {
  read(authorization: McpReadAuthorization, signal: AbortSignal): Promise<{
    version: string;
    text: string;
  } | undefined>;
}

/** Capture a policy value without getters, coercion or private-field conversion. */
export function snapshotReleasedGuidance(value: unknown): { version: string; text: string } {
  const { version, text } = snapshotJsonFields(value, ["version", "text"], { stringCharacters: 2000, arrayItems: 50 });
  if (typeof version !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(version)
    || typeof text !== "string" || !text.trim()) throw new Error("Guidance unavailable");
  return { version, text };
}

/** Format approved guidance, including attribution/version in the 2,000-character field limit. */
export function formatReleasedGuidance(value: unknown): string {
  const { version, text: body } = snapshotReleasedGuidance(value);
  const text = `Rental OS guidance (${version})\n${body}`;
  if ([...text].length > 2000) throw new Error("Guidance unavailable");
  return text;
}

/** Format one released instruction snapshot. No prompt/resource capability is advertised. */
export async function releasedInstructions(provider: McpInstructionsProvider, authorization: McpReadAuthorization,
  signal: AbortSignal): Promise<string | undefined> {
  if (signal.aborted) throw new Error("Guidance unavailable");
  const value = await provider.read(authorization, signal).catch(() => {
    // SDK factory errors must not expose the policy provider's private details.
    throw new Error("Guidance unavailable");
  });
  if (signal.aborted) throw new Error("Guidance unavailable");
  if (value === undefined) return undefined;
  return formatReleasedGuidance(value);
}
