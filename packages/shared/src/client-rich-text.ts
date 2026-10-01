/** Versioned, non-executable document nodes in the existing body string. Plain text remains supported. */
export type ClientRichTextNode = { type: "text"; text: string } | { type: "node"; name: string; attrs?: { href?: string }; children: ClientRichTextNode[] };
export const CLIENT_RICH_TEXT_PREFIX = "rental-rich-text:v1\n";
const tags = new Set(["p", "br", "strong", "em", "s", "code", "a", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "pre", "hr"]);
export function safeDocumentHref(value: string): boolean {
  return !/[\u0000-\u0020\u007f\\]/.test(value) && (/^https?:\/\//i.test(value) || /^(mailto:|tel:)/i.test(value) || /^\/(?!\/)/.test(value) || value.startsWith("#"));
}
export function parseClientRichText(body: string, maxLength = 20000): ClientRichTextNode[] | null {
  if (!body.startsWith(CLIENT_RICH_TEXT_PREFIX) || body.length > maxLength) return null;
  let count = 0;
  const clean = (input: unknown, depth: number): ClientRichTextNode[] => {
    if (!Array.isArray(input) || depth > 20) throw new Error("Invalid document");
    return input.flatMap((value): ClientRichTextNode[] => {
      if (++count > 2000 || !value || typeof value !== "object") throw new Error("Invalid document");
      const node = value as Record<string, unknown>;
      if (node.type === "text" && typeof node.text === "string") return [{ type: "text", text: node.text }];
      if (node.type !== "node" || typeof node.name !== "string" || !tags.has(node.name)) return [];
      const rawHref = node.attrs && typeof node.attrs === "object" ? (node.attrs as Record<string, unknown>).href : undefined;
      const href = typeof rawHref === "string" && safeDocumentHref(rawHref) ? rawHref : undefined;
      return [{ type: "node", name: node.name, ...(node.name === "a" && href ? { attrs: { href } } : {}), children: clean(node.children, depth + 1) }];
    });
  };
  try { return clean(JSON.parse(body.slice(CLIENT_RICH_TEXT_PREFIX.length)), 0); } catch { return null; }
}
