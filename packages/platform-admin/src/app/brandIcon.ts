/** Shared image-only branding. Never inject uploaded SVG into the document DOM.
 * Simple neutral artwork can be recolored; complex/multicolor SVG stays original.
 * This is a conservative paint classifier, not a general-purpose SVG sanitizer. */
import defaultIcon from "../../public/brand/nativark-icon.svg?raw";

const svgDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const ink = (dark: boolean) => dark ? "#ffffff" : "#000000";
export function defaultAdminBrandIcon(dark: boolean) {
  // Only the root currentColor changes: the black/white page masks must stay intact.
  return svgDataUrl(defaultIcon.replace(/<svg\b/iu, `<svg color="${ink(dark)}"`));
}

/** Reject active/non-image URLs; relative and signed image URLs keep their exact source. */
export function safeBrandIconUrl(value?: string) {
  const url = value?.trim();
  if (!url || /[\u0000-\u001f\u007f]/u.test(url)) return undefined;
  if (/^data:/iu.test(url)) return /^data:image\/(?:svg\+xml|png|jpeg|gif|webp|avif)(?:;charset=[a-z\d_-]+)?(?:;base64)?,/iu.test(url) ? url : undefined;
  try {
    const parsed = new URL(url, "https://brand.invalid/");
    return ["https:", "http:"].includes(parsed.protocol) ? url : undefined;
  } catch { return undefined; }
}
export function isSvgBrandIcon(url: string) {
  return /^data:image\/svg\+xml[;,]/iu.test(url) || /\.svg(?:[?#]|$)/iu.test(url);
}

export function adaptMonochromeBrandSvg(source: string, dark: boolean): string | undefined {
  if (source.length > 512 * 1024) return undefined;
  const svg = source.replace(/^\s*<\?xml[^?]*\?>/u, "").trim();
  if (!/^<svg\b/iu.test(svg) || !/<\/svg>$/iu.test(svg) || /<!|<\?|\b(?:href|style|filter|mask|clip-path|on\w+)\s*=|url\s*\(/iu.test(svg)) return undefined;
  const tags = [...svg.matchAll(/<\/?([\w:-]+)\b[^>]*>/gu)];
  if (tags.some(tag => !/^(?:svg|g|path|circle|ellipse|rect|line|polyline|polygon|title|desc)$/u.test(tag[1]))) return undefined;
  const paints = [...svg.matchAll(/\b(?:fill|stroke|color)\s*=\s*(["'])(.*?)\1/giu)].map(match => match[2].trim().toLowerCase());
  const neutral = (paint: string) => /^(?:black|#000(?:000)?|currentcolor)$/u.test(paint) ? "black"
    : /^(?:white|#fff(?:fff)?)$/u.test(paint) ? "white" : paint;
  const colors = new Set(paints.filter(paint => paint !== "none").map(neutral));
  if ([...colors].some(color => color !== "black" && color !== "white") || colors.size > 1) return undefined;
  // Include inherited/default paint, not just explicit attributes. For example a
  // white rect plus an implicitly black path is two-tone artwork, not a white mark.
  const stack = [{ fill: "black", stroke: "none", color: "black" }];
  const visibleColors = new Set<string>();
  for (const tag of tags) {
    if (/^<\//u.test(tag[0])) { if (stack.length > 1) stack.pop(); continue; }
    const inherited = stack[stack.length - 1];
    const attributes = Object.fromEntries([...tag[0].matchAll(/\b(fill|stroke|color)\s*=\s*(["'])(.*?)\2/giu)].map(match => [match[1].toLowerCase(), match[3].trim().toLowerCase()]));
    const paint = { ...inherited, ...attributes };
    if (!/^(?:svg|g|title|desc)$/u.test(tag[1])) {
      for (const value of [paint.fill, paint.stroke]) if (value !== "none") visibleColors.add(neutral(value === "currentcolor" ? paint.color : value));
    }
    if (!/\/\s*>$/u.test(tag[0])) stack.push(paint);
  }
  if (visibleColors.size > 1) return undefined;
  // Avoid flattening a white background and black foreground into one solid square.
  const recolored = svg.replace(/\b(fill|stroke|color)\s*=\s*(["'])(.*?)\2/giu,
    (original, property: string, _quote: string, paint: string) => paint.trim().toLowerCase() === "none" ? original : `${property}="${ink(dark)}"`);
  return svgDataUrl(recolored.replace(/<svg\b([^>]*)>/iu, (tag, attributes: string) =>
    `<svg${attributes}${/\bfill\s*=/iu.test(attributes) ? "" : ` fill="${ink(dark)}"`}${/\bcolor\s*=/iu.test(attributes) ? "" : ` color="${ink(dark)}"`}>`));
}

/** Optional SVG inspection only: no auth headers, customer API or arbitrary proxy. */
export async function readBrandSvg(url: string, signal: AbortSignal): Promise<string | undefined> {
  if (!safeBrandIconUrl(url) || !isSvgBrandIcon(url)) return undefined;
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok || Number(response.headers.get("content-length")) > 512 * 1024) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let length = 0, svg = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return svg + decoder.decode();
      length += value.byteLength;
      if (length > 512 * 1024) return undefined;
      svg += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
