/** 有界 MIME 读取：只释放文本/信封和附件元数据，不执行 HTML、下载远端图像或内联附件。 */
export interface ParsedInboundMail {
  senderEmail: string; senderName: string; recipient: string; subject: string; messageId?: string; sentAt?: Date;
  text: string; attachments: Array<{ name: string; contentType: string; size: number }>;
}
const decodeBytes = (value: Buffer, charset = "utf-8") => {
  try { return new TextDecoder(charset).decode(value); } catch { return value.toString("utf8"); }
};
function quotedPrintable(value: string, header = false) {
  const raw = value.replace(/=\r?\n/gu, "").replace(header ? /_/gu : /$^/gu, " ");
  const bytes: number[] = [];
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === "=" && /^[A-Fa-f0-9]{2}$/u.test(raw.slice(index + 1, index + 3))) { bytes.push(parseInt(raw.slice(index + 1, index + 3), 16)); index += 2; }
    else bytes.push(raw.charCodeAt(index) & 255);
  }
  return Buffer.from(bytes);
}
export function decodeMailHeader(value: string) {
  return value.replace(/(\?=)\s+(=\?)/gu, "$1$2").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/giu,
    (_match, charset: string, mode: string, body: string) => decodeBytes(mode.toLowerCase() === "b" ? Buffer.from(body, "base64") : quotedPrintable(body, true), charset))
    .replace(/[\r\n\0]/gu, " ").slice(0, 4096);
}
function splitEntity(raw: string) {
  const end = raw.search(/\r?\n\r?\n/u);
  if (end < 0 || end > 65536) throw new Error("邮件头缺失或超出读取限制");
  const header = raw.slice(0, end).replace(/\r?\n[\t ]+/gu, " ");
  const headers = new Map<string, string>();
  for (const line of header.split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon > 0) { const key = line.slice(0, colon).toLowerCase(); if (!headers.has(key)) headers.set(key, line.slice(colon + 1).trim()); }
  }
  return { headers, body: raw.slice(end).replace(/^\r?\n\r?\n/u, "") };
}
function parameter(header: string, name: string) {
  const encoded = new RegExp(`(?:^|;)\\s*${name}\\*=([^;]+)`, "iu").exec(header)?.[1];
  if (encoded) {
    try { const [charset, , content] = encoded.replace(/^"|"$/gu, "").split("'"); return decodeBytes(Buffer.from((content ?? "").replace(/%([0-9a-f]{2})/giu, (_, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1"), charset); }
    catch { return ""; }
  }
  const value = new RegExp(`(?:^|;)\\s*${name}=(?:"([^"\\r\\n]*)"|([^;]*))`, "iu").exec(header);
  return decodeMailHeader((value?.[1] ?? value?.[2] ?? "").trim());
}
function htmlText(value: string) {
  return value.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "")
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|hr)\b[^>]*>/giu, "\n").replace(/<[^>]*>/gu, "")
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_, code: string) => {
      const point = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/giu, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[entity.toLowerCase()]!))
    .replace(/\n[\t ]+/gu, "\n").replace(/\n{4,}/gu, "\n\n\n").trim();
}
export function parseInboundMail(raw: Buffer): ParsedInboundMail {
  if (raw.length > 1048576) throw new Error("邮件超过首期 1 MB 正文读取上限");
  const root = splitEntity(raw.toString("latin1"));
  const from = decodeMailHeader(root.headers.get("from") ?? "");
  const senderEmail = (/<([^<>]+@[^<>]+)>/u.exec(from)?.[1] ?? /([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+)/u.exec(from)?.[1] ?? "未知发件地址").slice(0, 320);
  const senderName = from.replace(/<[^<>]+>/gu, "").replace(/^"|"$/gu, "").trim() || senderEmail;
  const attachments: ParsedInboundMail["attachments"] = [];
  const plain: string[] = [], html: string[] = [];
  let parts = 0;
  const visit = (entity: ReturnType<typeof splitEntity>, depth: number) => {
    if (++parts > 100 || depth > 10) throw new Error("邮件 MIME 层级或分段超出限制");
    const typeHeader = entity.headers.get("content-type") ?? "text/plain; charset=us-ascii";
    const type = typeHeader.split(";")[0].trim().toLowerCase();
    const boundary = parameter(typeHeader, "boundary");
    if (type.startsWith("multipart/")) {
      if (!boundary || boundary.length > 200 || /[\r\n]/u.test(boundary)) throw new Error("邮件 MIME 边界无效");
      const markers = new RegExp(`(?:^|\\r?\\n)--${boundary.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(--)?[\\t ]*(?:\\r?\\n|$)`, "gu");
      let match: RegExpExecArray | null, start: number | undefined;
      while ((match = markers.exec(entity.body))) {
        if (start !== undefined) {
          const content = entity.body.slice(start, match.index).replace(/\r?\n$/u, "");
          if (content.trim()) visit(splitEntity(content), depth + 1);
        }
        if (match[1]) return;
        start = markers.lastIndex;
      }
      if (start !== undefined && entity.body.slice(start).trim()) visit(splitEntity(entity.body.slice(start)), depth + 1);
      return;
    }
    const encoding = entity.headers.get("content-transfer-encoding")?.toLowerCase();
    const bytes = encoding === "base64" ? Buffer.from(entity.body.replace(/\s/gu, ""), "base64")
      : encoding === "quoted-printable" ? quotedPrintable(entity.body) : Buffer.from(entity.body, "latin1");
    const disposition = entity.headers.get("content-disposition") ?? "";
    const filename = parameter(disposition, "filename") || parameter(typeHeader, "name");
    if (filename || /attachment/iu.test(disposition) || !["text/plain", "text/html"].includes(type)) {
      attachments.push({ name: (filename || "附件").replace(/[\r\n\0\\/]/gu, "_").slice(0, 191), contentType: type.slice(0, 100), size: bytes.length }); return;
    }
    const decoded = decodeBytes(bytes, parameter(typeHeader, "charset") || "utf-8");
    (type === "text/html" ? html : plain).push(decoded);
  };
  visit(root, 0);
  const date = new Date(root.headers.get("date") ?? "");
  return { senderEmail, senderName: senderName.slice(0, 191), recipient: decodeMailHeader(root.headers.get("to") ?? "").slice(0, 1000),
    subject: decodeMailHeader(root.headers.get("subject") ?? "").slice(0, 500) || "无主题邮件", messageId: decodeMailHeader(root.headers.get("message-id") ?? "").slice(0, 191) || undefined,
    sentAt: Number.isFinite(date.getTime()) ? date : undefined, text: (plain.length ? plain.join("\n\n") : htmlText(html.join("\n\n"))).replace(/\0/gu, "").slice(0, 100000), attachments };
}
