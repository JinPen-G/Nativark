/** Assemble only the reachable original schema components supplied by the owner.
 * This adapts the object root for MCP; it keeps every original union branch. */
import type { JsonSchemaType } from "@modelcontextprotocol/server";

export function assembleOriginalReadSchema(root: JsonSchemaType,
  components: Readonly<Record<string, JsonSchemaType>> = {}): JsonSchemaType {
  const reachable = new Map<string, JsonSchemaType>();
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "$ref") { visit(child); continue; }
      if (typeof child !== "string" || !child.startsWith("#/components/schemas/")) throw new TypeError("Original result schema reference unavailable");
      const reference = child.slice("#/components/schemas/".length);
      if (reachable.has(reference)) continue;
      if (!Object.hasOwn(components, reference) || !components[reference])
        throw new TypeError(`Original result schema reference unavailable: ${reference}`);
      const target = components[reference];
      reachable.set(reference, target);
      visit(target);
    }
  }
  visit(root);
  // The root lists possible keys; only the original oneOf branches supply
  // required fields, types and the exact combination for each outcome.
  const properties = root.properties ?? Object.fromEntries(root.oneOf?.flatMap(branch =>
    typeof branch === "object" ? Object.keys(branch.properties ?? {}).map(key => [key, {}]) : []) ?? []);
  const schema = { type: "object" as const, ...structuredClone(root), properties: structuredClone(properties),
    additionalProperties: false, components: { schemas: structuredClone(Object.fromEntries(reachable)) } };
  return schema;
}
