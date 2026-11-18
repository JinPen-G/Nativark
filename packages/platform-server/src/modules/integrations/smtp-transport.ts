/** 受控 SMTP 出站：只支持加密 SMTP/STARTTLS 与 PLAIN/LOGIN；连接固定到已核定 IP。
 * 不读取收件箱、不记录凭据、不自动重投 DATA 结果未知的邮件。 */
import { lookup } from "node:dns/promises";
import { isIP, connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { isPrivateOrLocalHost } from "../../common/outbound-url";

export class SmtpDeliveryUnknownError extends Error {
  constructor() { super("邮件提交后未收到确定响应，请在邮箱服务商核对，系统不会自动重发"); }
}
export class SmtpTransportError extends Error {}
export interface SmtpConnection {
  host: string; port: number; secure: boolean; username: string; password: string;
  fromEmail: string; fromName?: string; replyTo?: string;
}
export interface SmtpMessage { to: string; subject: string; text: string; html?: string; messageId: string; }

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 191 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/u.test(email)
    || email.includes("..") || /[\r\n\0]/u.test(email)) throw new SmtpTransportError("请输入有效的邮箱地址");
  return email;
}

export function smtpConnection(settings: Record<string, unknown>, credentials: Record<string, string>): SmtpConnection {
  const host = String(settings.host ?? "").trim().toLowerCase();
  const port = Number(settings.port);
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/u.test(host) || host.includes("..") || host.startsWith("-") || host.endsWith("-"))
    throw new SmtpTransportError("SMTP Host 应填写域名或 IPv4 地址，不包含协议、端口和路径");
  if (![25, 465, 587, 2525].includes(port)) throw new SmtpTransportError("SMTP 端口支持 25、465、587 或 2525");
  if (settings.secure !== undefined && typeof settings.secure !== "boolean") throw new SmtpTransportError("TLS 配置必须是布尔值");
  const username = credentials.username ?? "", password = credentials.password ?? "";
  if (!username || !password || username.length > 320 || password.length > 4096 || /[\r\n\0]/u.test(username + password))
    throw new SmtpTransportError("请配置有效的邮箱账号和密码或授权码");
  const fromName = String(settings.fromName ?? "").trim();
  if (fromName.length > 100 || /[\r\n\0]/u.test(fromName)) throw new SmtpTransportError("发件人名称格式无效");
  return { host, port, secure: settings.secure === true, username, password, fromName,
    fromEmail: normalizeEmail(String(settings.fromEmail ?? "")),
    replyTo: settings.replyTo ? normalizeEmail(String(settings.replyTo)) : undefined };
}

function unsafeAddress(address: string) {
  return isPrivateOrLocalHost(address) || isIP(address) === 4 && Number(address.split(".")[0]) >= 224
    || /^ff/iu.test(address) || /^192\.0\.0\./u.test(address);
}

export async function pinnedMailAddress(host: string) {
  const allowPrivate = process.env.INTEGRATION_ALLOW_PRIVATE_ENDPOINTS === "true";
  if (!allowPrivate && unsafeAddress(host)) throw new SmtpTransportError("SMTP 服务器不能指向本机、内网或元数据地址");
  let addresses: Awaited<ReturnType<typeof lookup>>[];
  try { addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true }); }
  catch { throw new SmtpTransportError("SMTP 服务器域名无法解析"); }
  if (!addresses.length || !allowPrivate && addresses.some(row => unsafeAddress(row.address)))
    throw new SmtpTransportError("SMTP 服务器不能解析到本机或内网地址");
  return addresses[0];
}

type Reply = { code: number; lines: string[] };
class SmtpSession {
  private buffer = "";
  private lines: string[] = [];
  private replies: Reply[] = [];
  private waiter?: { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private failure?: Error;
  private bytes = 0;
  constructor(public socket: Socket | TLSSocket) { this.attach(); }
  private data = (chunk: Buffer) => {
    this.bytes += chunk.length;
    this.buffer += chunk.toString("utf8");
    if (this.bytes > 65536 || this.buffer.length > 8192) { this.fail(new SmtpTransportError("SMTP 响应超过限制")); return; }
    let end: number;
    while ((end = this.buffer.indexOf("\r\n")) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 2);
      if (!/^\d{3}[ -]/u.test(line) || line.length > 2048) { this.fail(new SmtpTransportError("SMTP 响应格式无效")); return; }
      if (this.lines.length && this.lines[0].slice(0, 3) !== line.slice(0, 3)) { this.fail(new SmtpTransportError("SMTP 多行响应格式无效")); return; }
      this.lines.push(line);
      if (line[3] === " ") {
        const reply = { code: Number(line.slice(0, 3)), lines: this.lines }; this.lines = [];
        if (this.waiter) { const pending = this.waiter; this.waiter = undefined; clearTimeout(pending.timer); pending.resolve(reply); }
        else this.replies.push(reply);
      }
    }
  };
  private error = () => this.fail(new SmtpTransportError("SMTP 连接中断，请检查服务器、TLS 证书和网络"));
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    if (this.waiter) { clearTimeout(this.waiter.timer); this.waiter.reject(error); this.waiter = undefined; }
    this.socket.destroy();
  }
  private attach() { this.socket.on("data", this.data); this.socket.on("error", this.error); this.socket.on("close", this.error); }
  private detach() { this.socket.off("data", this.data); this.socket.off("error", this.error); this.socket.off("close", this.error); }
  read(): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.replies.length) return Promise.resolve(this.replies.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new SmtpTransportError("SMTP 响应超时")), 8000);
      this.waiter = { resolve, reject, timer };
    });
  }
  async expect(codes: number[], command?: string) {
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    const reply = await this.read();
    if (!codes.includes(reply.code)) throw new SmtpTransportError(`SMTP 服务器拒绝请求（${reply.code}），请核对账号、发件地址和服务器设置`);
    return reply;
  }
  async startTls(host: string) {
    if (this.buffer || this.replies.length || this.lines.length) throw new SmtpTransportError("SMTP TLS 升级状态无效");
    this.detach();
    const secured = connectTls({ socket: this.socket, servername: isIP(host) ? undefined : host, rejectUnauthorized: true, minVersion: "TLSv1.2" });
    this.socket = secured; this.attach();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { secured.destroy(); reject(new SmtpTransportError("SMTP TLS 握手超时")); }, 8000);
      const cleanup = () => { clearTimeout(timer); secured.off("error", failed); };
      const failed = () => { cleanup(); reject(new SmtpTransportError("SMTP TLS 证书或加密连接验证失败")); };
      secured.once("error", failed); secured.once("secureConnect", () => { cleanup(); resolve(); });
    });
  }
  close() { this.detach(); this.socket.destroy(); }
}

function encodedHeader(value: string) {
  if (!value || value.length > 200 || /[\r\n\0]/u.test(value)) throw new SmtpTransportError("邮件标题格式无效");
  const segments: string[] = [];
  let current = "";
  for (const char of value) {
    if (Buffer.byteLength(current + char, "utf8") > 42) { segments.push(current); current = ""; }
    current += char;
  }
  if (current) segments.push(current);
  return segments.map(part => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`).join("\r\n ");
}
const base64Lines = (value: string) => Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/gu)?.join("\r\n") ?? "";

export function mimeMessage(config: SmtpConnection, message: SmtpMessage) {
  const to = normalizeEmail(message.to);
  if (!/^[A-Za-z0-9._-]{1,128}@[A-Za-z0-9.-]{1,253}$/u.test(message.messageId)) throw new SmtpTransportError("邮件 Message-ID 格式无效");
  if (Buffer.byteLength(message.text + (message.html ?? ""), "utf8") > 256000) throw new SmtpTransportError("邮件内容超出长度限制");
  const boundary = `nativark_${message.messageId.split("@")[0]}`;
  const headers = [`From: ${config.fromName ? `${encodedHeader(config.fromName)} ` : ""}<${config.fromEmail}>`, `To: <${to}>`,
    `Subject: ${encodedHeader(message.subject)}`, `Message-ID: <${message.messageId}>`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    ...(config.replyTo ? [`Reply-To: <${config.replyTo}>`] : [])];
  if (!message.html) return [...headers, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(message.text)].join("\r\n");
  return [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(message.text), `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(message.html), `--${boundary}--`, ""].join("\r\n");
}

export async function runSmtp(config: SmtpConnection, message?: SmtpMessage) {
  const address = await pinnedMailAddress(config.host);
  const options = { host: address.address, port: config.port, family: address.family };
  const socket = config.secure
    ? connectTls({ ...options, servername: isIP(config.host) ? undefined : config.host, rejectUnauthorized: true, minVersion: "TLSv1.2" })
    : connectTcp(options);
  const session = new SmtpSession(socket);
  const lifetime = setTimeout(() => socket.destroy(), 40000);
  let committed = false, accepted = false;
  try {
    await session.expect([220]);
    let hello = await session.expect([250], "EHLO nativark");
    if (!config.secure) {
      if (!hello.lines.some(line => /\bSTARTTLS\b/iu.test(line))) throw new SmtpTransportError("SMTP 服务器不支持 STARTTLS，请使用直接 TLS，不能发送明文密码");
      await session.expect([220], "STARTTLS"); await session.startTls(config.host);
      hello = await session.expect([250], "EHLO nativark");
    }
    const auth = hello.lines.find(line => /^250[ -]AUTH[ =]/iu.test(line)) ?? "";
    if (/\bPLAIN\b/iu.test(auth)) {
      await session.expect([235], `AUTH PLAIN ${Buffer.from(`\0${config.username}\0${config.password}`).toString("base64")}`);
    } else if (/\bLOGIN\b/iu.test(auth)) {
      await session.expect([334], "AUTH LOGIN"); await session.expect([334], Buffer.from(config.username).toString("base64"));
      await session.expect([235], Buffer.from(config.password).toString("base64"));
    } else throw new SmtpTransportError("SMTP 服务器未提供支持的 PLAIN/LOGIN 登录方式");
    if (message) {
      const mime = mimeMessage(config, message);
      await session.expect([250], `MAIL FROM:<${config.fromEmail}>`);
      await session.expect([250, 251], `RCPT TO:<${normalizeEmail(message.to)}>`);
      await session.expect([354], "DATA");
      // 从 DATA 终止行开始，断线/超时不证明服务器未受理，绝不自动重发。
      committed = true;
      session.socket.write(`${mime.replace(/(^|\r\n)\./gu, "$1..")}\r\n.\r\n`);
      const result = await session.read();
      if (result.code !== 250) {
        if (result.code >= 400 && result.code <= 599) { committed = false; throw new SmtpTransportError(`SMTP 服务器拒绝邮件（${result.code}）`); }
        throw new SmtpDeliveryUnknownError();
      }
      accepted = true;
    }
    try { await session.expect([221], "QUIT"); } catch { /* 已确认受理不因 QUIT 断线改判失败。 */ }
    return { messageId: message?.messageId };
  } catch (error) {
    if (committed && !accepted) throw new SmtpDeliveryUnknownError();
    throw error instanceof SmtpTransportError ? error : new SmtpTransportError("SMTP 连接失败，请检查服务器、TLS 证书和登录设置");
  } finally { clearTimeout(lifetime); session.close(); }
}
