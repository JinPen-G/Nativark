/** 只读 IMAP：EXAMINE + BODY.PEEK，不修改已读标记、删除邮件或发起附件下载。
 * UIDVALIDITY/UID 由服务器提供；加密、固定DNS地址及有界literal由此端口约束。 */
import { connect, type TLSSocket } from "node:tls";
import { isIP } from "node:net";
import { pinnedMailAddress, type SmtpConnection } from "./smtp-transport";
import { parseInboundMail, type ParsedInboundMail } from "./inbound-mail-codec";

export interface ImapConnection { host: string; port: number; mailbox: string; username: string; password: string; }
export interface ReceivedImapMail { uid: number; uidValidity: string; receivedAt: Date; message: ParsedInboundMail; }
export class ImapReadError extends Error {}
export function imapConnection(settings: Record<string, unknown>, account: Pick<SmtpConnection, "username" | "password">): ImapConnection {
  const host = String(settings.imapHost ?? "").trim().toLowerCase(), port = Number(settings.imapPort ?? 993);
  const mailbox = String(settings.imapMailbox ?? "INBOX").trim();
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/u.test(host) || host.includes("..") || port !== 993)
    throw new ImapReadError("IMAP 接收需填写有效服务器域名和 993 TLS 端口");
  if (!mailbox || mailbox.length > 100 || /[\r\n\0]/u.test(mailbox)) throw new ImapReadError("IMAP 收件文件夹无效");
  return { host, port, mailbox, ...account };
}
const quote = (value: string) => `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
type Packet = { lines: string[]; literals: Buffer[] };
class ImapSession {
  private buffer = Buffer.alloc(0);
  private literalBytes?: number;
  private sequence = 0;
  private greeting?: string;
  private error?: Error;
  private current?: { tag: string; packet: Packet; resolve: (packet: Packet) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  constructor(private readonly socket: TLSSocket) {
    socket.on("data", this.onData); socket.on("error", this.failed); socket.on("close", this.failed);
  }
  private failed = () => {
    this.error = new ImapReadError("IMAP 连接或证书验证失败，请核对接收服务器与授权码");
    if (this.current) { clearTimeout(this.current.timer); this.current.reject(this.error); this.current = undefined; }
  };
  private onData = (bytes: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > 1100000) { this.failed(); this.socket.destroy(); return; }
    while (this.buffer.length) {
      if (this.literalBytes !== undefined) {
        if (this.buffer.length < this.literalBytes) return;
        const literal = this.buffer.subarray(0, this.literalBytes); this.buffer = this.buffer.subarray(this.literalBytes); this.literalBytes = undefined;
        this.current?.packet.literals.push(Buffer.from(literal)); continue;
      }
      const end = this.buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buffer.subarray(0, end).toString("utf8"); this.buffer = this.buffer.subarray(end + 2);
      if (!this.greeting) {
        this.greeting = line;
        if (!/^\* OK\b/iu.test(line)) { this.failed(); this.socket.destroy(); }
        continue;
      }
      if (/^\* BYE\b/iu.test(line)) { this.failed(); this.socket.destroy(); return; }
      const pending = this.current;
      if (!pending) continue;
      pending.packet.lines.push(line);
      if (pending.packet.lines.length > 10000 || line.length > 65536 || pending.packet.literals.length > 3) { this.failed(); this.socket.destroy(); return; }
      const literal = /\{(\d+)\+?\}$/u.exec(line);
      if (literal) {
        const count = Number(literal[1]);
        if (count > 1048576) { this.failed(); this.socket.destroy(); return; }
        this.literalBytes = count;
      }
      if (line.startsWith(`${pending.tag} `)) {
        clearTimeout(pending.timer); this.current = undefined;
        if (!line.startsWith(`${pending.tag} OK`)) pending.reject(new ImapReadError("IMAP 请求被拒绝，请核对账号权限和文件夹"));
        else pending.resolve(pending.packet);
      }
    }
  };
  async ready() {
    if (this.error) throw this.error;
    if (this.greeting) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new ImapReadError("IMAP 登录欢迎响应超时")); }, 8000);
      const data = () => { if (this.greeting) { cleanup(); this.error ? reject(this.error) : resolve(); } };
      const failed = () => { cleanup(); reject(this.error ?? new ImapReadError("IMAP 连接失败")); };
      const cleanup = () => { clearTimeout(timer); this.socket.off("data", data); this.socket.off("error", failed); this.socket.off("close", failed); };
      this.socket.on("data", data); this.socket.once("error", failed); this.socket.once("close", failed);
    });
  }
  command(value: string) {
    if (this.error) return Promise.reject(this.error);
    if (this.current) return Promise.reject(new ImapReadError("IMAP 请求必须依次执行"));
    const tag = `N${++this.sequence}`;
    return new Promise<Packet>((resolve, reject) => {
      const timer = setTimeout(() => { this.failed(); this.socket.destroy(); }, 8000);
      this.current = { tag, packet: { lines: [], literals: [] }, resolve, reject, timer };
      this.socket.write(`${tag} ${value}\r\n`);
    });
  }
  close() { if (this.current) clearTimeout(this.current.timer); this.socket.off("data", this.onData); this.socket.off("error", this.failed); this.socket.off("close", this.failed); this.socket.destroy(); }
}
export async function readImapMailbox(config: ImapConnection, options: { cursor?: { uidValidity: string; uid: number }; testOnly?: boolean; limit?: number } = {}) {
  const address = await pinnedMailAddress(config.host);
  const socket = connect({ host: address.address, port: config.port,
    servername: isIP(config.host) ? undefined : config.host, rejectUnauthorized: true, minVersion: "TLSv1.2" });
  const session = new ImapSession(socket), timer = setTimeout(() => socket.destroy(), 90000);
  try {
    await session.ready();
    await session.command(`LOGIN ${quote(config.username)} ${quote(config.password)}`);
    const examined = await session.command(`EXAMINE ${quote(config.mailbox)}`);
    const uidValidity = examined.lines.map(line => /\[UIDVALIDITY (\d+)\]/iu.exec(line)?.[1]).find(Boolean);
    if (!uidValidity) throw new ImapReadError("IMAP 服务器未返回 UIDVALIDITY，不能安全去重");
    if (options.testOnly) return { messages: [] as ReceivedImapMail[], uidValidity, nextUid: options.cursor?.uid ?? 0, checked: 0, hasMore: false };
    const start = options.cursor?.uidValidity === uidValidity ? options.cursor.uid + 1 : 1;
    const search = await session.command(`UID SEARCH UID ${start}:*`);
    const found = search.lines.filter(line => /^\* SEARCH\b/iu.test(line)).flatMap(line => line.slice(8).trim().split(/\s+/u))
      .map(Number).filter(uid => Number.isSafeInteger(uid) && uid >= start).sort((a, b) => a - b);
    const limit = Math.max(1, Math.min(20, options.limit ?? 20)), uids = found.slice(0, limit);
    const messages: ReceivedImapMail[] = [];
    let nextUid = options.cursor?.uidValidity === uidValidity ? options.cursor.uid : 0;
    for (const uid of uids) {
      const meta = await session.command(`UID FETCH ${uid} (UID RFC822.SIZE INTERNALDATE)`);
      const metadata = meta.lines.find(line => new RegExp(`\\bUID ${uid}\\b`, "u").test(line));
      const size = metadata ? Number(/RFC822\.SIZE (\d+)/iu.exec(metadata)?.[1]) : NaN;
      if (!Number.isFinite(size)) throw new ImapReadError("IMAP 邮件大小无法核对");
      if (size > 1048576) throw new ImapReadError(`邮件 UID ${uid} 超过首期 1 MB 读取上限，请移至其他文件夹后再同步`);
      const receivedAt = new Date(metadata ? /INTERNALDATE "([^"]+)"/iu.exec(metadata)?.[1] ?? "" : "");
      const packet = await session.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);
      if (packet.literals.length !== 1 || !packet.lines.some(line => new RegExp(`\\bUID ${uid}\\b`, "u").test(line))) throw new ImapReadError("IMAP 邮件正文与原 UID 不一致");
      const message = parseInboundMail(packet.literals[0]);
      messages.push({ uid, uidValidity, receivedAt: Number.isFinite(receivedAt.getTime()) ? receivedAt : message.sentAt ?? new Date(), message });
      nextUid = uid;
    }
    return { messages, uidValidity, nextUid, checked: uids.length, hasMore: found.length > uids.length };
  } finally { clearTimeout(timer); session.close(); }
}
