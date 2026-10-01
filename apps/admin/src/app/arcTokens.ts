import { resolveAdminPrimaryColor } from "./designTokens";

/** The neutral/semantic values are the UIArc foundation's OKLCH values, converted
 * to sRGB for AntD's color algorithm. The original full palette lives in vendor/foundation.css. */
export function oklchToHex(lightness: number, chroma = 0, hue = 0) {
  const angle = hue * Math.PI / 180, a = chroma * Math.cos(angle), b = chroma * Math.sin(angle);
  const l = (lightness + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (lightness - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (lightness - .0894841775 * a - 1.291485548 * b) ** 3;
  return "#" + [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(value => {
    const linear = Math.max(0, Math.min(1, value));
    return Math.round(255 * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055)).toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}

export function getArcPalette(dark: boolean, tenantColor?: string | null) {
  const custom = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(tenantColor?.trim() ?? "");
  return {
    custom, primary: custom ? resolveAdminPrimaryColor(tenantColor) : oklchToHex(dark ? .8 : .33),
    background: oklchToHex(dark ? .19 : 1), surface: oklchToHex(dark ? .215 : 1),
    raised: oklchToHex(dark ? .24 : 1), muted: oklchToHex(dark ? .26 : .978),
    foreground: oklchToHex(dark ? .96 : .15), secondary: oklchToHex(dark ? .77 : .46),
    border: oklchToHex(dark ? .29 : .935),
    success: oklchToHex(dark ? .78 : .49, dark ? .18 : .19, 150),
    warning: oklchToHex(dark ? .83 : .58, dark ? .17 : .18, dark ? 80 : 75),
    danger: oklchToHex(dark ? .76 : .54, dark ? .2 : .21, 25)
  };
}

export function applyArcThemeTokens(root: HTMLElement, dark: boolean, tenantColor?: string | null) {
  const palette = getArcPalette(dark, tenantColor);
  root.dataset.theme = dark ? "dark" : "light";
  const overrides = ["--accent", "--accent-strong", "--accent-subtle", "--accent-foreground", "--control-on", "--control-glyph", "--control-thumb-on", "--control-fill"];
  overrides.forEach(name => root.style.removeProperty(name));
  delete root.dataset.tenantAccent;
  if (!palette.custom) return;
  root.dataset.tenantAccent = "";
  const hex = palette.primary.slice(1);
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = channels.map(channel => {
    const normalized = channel / 255;
    return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const ink = luminance > .179 ? "#000000" : "#FFFFFF";
  const values = { "--accent": palette.primary, "--accent-strong": palette.primary,
    "--accent-subtle": `rgb(${channels.join(" ")} / ${dark ? ".2" : ".1"})`,
    "--accent-foreground": ink, "--control-on": palette.primary, "--control-glyph": ink,
    "--control-thumb-on": ink, "--control-fill": palette.primary };
  Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
}
