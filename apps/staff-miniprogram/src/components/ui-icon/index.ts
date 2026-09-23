/**
 * 线性图标组件：SVG 以 data URI 交给 <image>，不依赖字体或网络。
 * 图标在 24×24 视口内以描边路径描述，尺寸由属性决定；颜色支持语义名（随深/浅色）或直接 #RRGGBB。
 */
import { semanticColor, themeEvents } from "../../core/theme";
const PATHS: Record<string, string> = {
  search: "M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14zM20 20l-3.5-3.5",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12l4 4L19 7",
  "check-circle": "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM8 12l3 3 5-6",
  heart: "M12 20.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V4M8 8l4-4 4 4",
  pin: "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  headset: "M4 13a8 8 0 0 1 16 0M4 13v4a2 2 0 0 0 2 2h1v-6H4zM20 13v4a2 2 0 0 1-2 2h-1v-6h3zM17 19a3 3 0 0 1-3 3h-2",
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5A7 7 0 0 0 19 12z",
  shield: "M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6l8-3zM9 12l2 2 4-4",
  ticket: "M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8zM12 7v2M12 11v2M12 15v2",
  orders: "M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM8.5 9h7M8.5 12.5h7M8.5 16h4",
  grid: "M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z",
  home: "M4 11l8-6.5L20 11M6 10v9.5h12V10M10 19.5v-5h4v5",
  user: "M12 12.5a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users: "M9 12a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 6.5M21.5 20a6 6 0 0 0-4-5.6",
  "user-search": "M10 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM3 20a7 7 0 0 1 10-6.3M17 19a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5zM19 21l1.5 1.5",
  calendar: "M4 6.5h16v13H4zM4 10h16M8 3.5v4M16 3.5v4",
  store: "M3 9l2-5h14l2 5M3 9h18M4 9v11h16V9M9 20v-6h6v6",
  truck: "M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4a2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
  crown: "M4 17l-1-9 5 4 4-6 4 6 5-4-1 9zM4 17h16v2H4z",
  info: "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 11v6M12 7.5v.5",
  alert: "M12 3l10 18H2L12 3zM12 10v5M12 17.5v.5",
  star: "M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z",
  camera: "M4 8h3l1.5-2.5h7L17 8h3v10H4zM12 16a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z",
  tent: "M2 20L12 4l10 16zM12 4v16M6.5 20L12 11l5.5 9",
  car: "M3 13l2-5h14l2 5v6h-2v-2H5v2H3zM3 13h18M7 16h2M15 16h2",
  crane: "M4 20h16M6 20V9M6 9h12l2 4M13 9v4M18 9l1.5 3M8 20V13h5v7",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  clock: "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 7v5l3 2",
  history: "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5M12 8v4l3 2",
  wallet: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V5.5A1.5 1.5 0 0 1 5.5 4H17v3M16 13.5h4v3h-4a1.5 1.5 0 0 1 0-3z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  compass: "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  edit: "M4 20h4l10-10-4-4L4 16zM13 7l4 4",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M9 12h9",
  box: "M3 8l9-4 9 4v9l-9 4-9-4zM3 8l9 4 9-4M12 12v9",
  "box-out": "M3 9l9-4 9 4v5M3 9l9 4 9-4M12 13v8M16 17l-4 4-4-4",
  "box-in": "M3 9l9-4 9 4v5M3 9l9 4 9-4M12 21v-8M8 17l4-4 4 4",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  barcode: "M4 6v12M8 6v12M11 6v12M14 6v12M18 6v12M20 6v12",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  tool: "M14.5 5.5a4 4 0 0 0 5 5L12 18a2.1 2.1 0 0 1-3-3l7.5-7.5zM9 15l-5 5",
  wrench: "M20.5 6.5a4.5 4.5 0 0 1-6 5.5L7 19.5a2 2 0 0 1-3-3l7.5-7.5a4.5 4.5 0 0 1 5.5-6l-2.5 2.5 1 2 2 1z",
  transfer: "M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4",
  plus: "M12 5v14M5 12h14",
  "plus-circle": "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 8v8M8 12h8",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1 1 0 1 0 0-2a1 1 0 0 0 0 2z",
  flash: "M13 3L5 13h6l-1 8 8-10h-6z",
  keyboard: "M3 7h18v11H3zM7 11h1M11 11h1M15 11h1M7 14.5h10",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  briefcase: "M4 8h16v11H4zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13h16",
  eye: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  question: "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17v.5",
  message: "M4 5h16v11H9l-5 4z",
  layers: "M12 4l9 5-9 5-9-5zM3 14l9 5 9-5",
  swap: "M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"
};

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(text: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index], b = bytes[index + 1], c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63] + (b === undefined ? "=" : BASE64[(triple >> 6) & 63]) + (c === undefined ? "=" : BASE64[triple & 63]);
  }
  return out;
}

const cache = new Map<string, string>();

export function iconSource(name: string, color: string, filled: boolean, strokeWidth: number): string {
  const key = `${name}|${color}|${filled}|${strokeWidth}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const path = PATHS[name] ?? PATHS.info;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="${path}" fill="${filled ? color : "none"}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const source = `data:image/svg+xml;base64,${base64(svg)}`;
  cache.set(key, source);
  return source;
}

export const ICON_NAMES = Object.keys(PATHS);

Component({
  options: { addGlobalClass: true },
  properties: {
    name: { type: String, value: "info" },
    // 语义色名（text/muted/primary…，见 core/theme SEMANTIC_COLORS）按当前深浅色解析；也兼容直接传 #RRGGBB。
    color: { type: String, value: "text" },
    /** rpx */
    size: { type: Number, value: 40 },
    filled: { type: Boolean, value: false },
    stroke: { type: Number, value: 1.8 }
  },
  data: { src: "" },
  lifetimes: {
    attached() {
      (this as unknown as { _themeOff?: () => void })._themeOff = themeEvents.on(() => this.render());
      this.render();
    },
    detached() {
      (this as unknown as { _themeOff?: () => void })._themeOff?.();
    }
  },
  observers: {
    "name, color, filled, stroke"() {
      this.render();
    }
  },
  methods: {
    render() {
      const { name, color, filled, stroke } = this.data as { name: string; color: string; filled: boolean; stroke: number };
      this.setData({ src: iconSource(name, semanticColor(color), filled, stroke) });
    }
  }
});
