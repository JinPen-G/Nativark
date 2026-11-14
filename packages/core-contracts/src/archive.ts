/**
 * 标准USTAR+gzip的确定性Core包；首版只接受普通文件，不接受链接、PAX或执行脚本。
 * 解析先核整个压缩包摘要与资源上限，返回内存文件，文件系统写入由受控安装阶段负责。
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { CoreArtifactHashSchema, CorePackagePathSchema } from "./manifest";

export const CORE_ARCHIVE_LIMITS = Object.freeze({ files: 5000, fileBytes: 32 * 1024 * 1024, totalBytes: 128 * 1024 * 1024 });
export interface CoreArchive { files: ReadonlyMap<string, Uint8Array>; sha256: string }
const block = 512;
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const padding = (length: number) => Math.ceil(length / block) * block;
const zero = (bytes: Uint8Array) => bytes.every(value => value === 0);

function names(names: readonly string[]): void {
  if (!names.length || names.length > CORE_ARCHIVE_LIMITS.files) throw new Error("Core包文件数量不在支持范围内");
  const seen = new Set<string>();
  for (const name of names) {
    CorePackagePathSchema.parse(name);
    if (name.split("/").some(part => /^(?:\.git|node_modules)$/i.test(part) || /^\.env(?:\.|$)/i.test(part) && part !== ".env.example"))
      throw new Error("Core包不能包含仓库元数据、依赖目录或实际环境配置");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error("Core包存在重复或仅大小写不同的路径");
    seen.add(key);
  }
  for (const name of seen) {
    const parts = name.split("/");
    while (parts.length > 1) {
      parts.pop();
      if (seen.has(parts.join("/"))) throw new Error("Core包文件路径与父目录冲突");
    }
  }
}

function tarName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  for (let index = name.lastIndexOf("/"); index > 0; index = name.lastIndexOf("/", index - 1)) {
    const prefix = name.slice(0, index), leaf = name.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(leaf) <= 100) return { name: leaf, prefix };
  }
  throw new Error("Core包路径超过USTAR支持的UTF-8长度");
}

export function createCoreArchive(files: ReadonlyMap<string, Uint8Array>): { bytes: Uint8Array; sha256: string } {
  const paths = [...files.keys()].sort(); names(paths);
  const chunks: Buffer[] = [];
  let total = 2 * block;
  for (const path of paths) {
    const content = files.get(path)!;
    total += block + padding(content.length);
    if (content.length > CORE_ARCHIVE_LIMITS.fileBytes || total > CORE_ARCHIVE_LIMITS.totalBytes)
      throw new Error("Core包超过单文件或总大小上限");
    const header = Buffer.alloc(block), entry = tarName(path);
    header.write(entry.name, 0, 100, "utf8"); header.write(entry.prefix, 345, 155, "utf8");
    const octal = (value: number, offset: number, length: number) => header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length, "ascii");
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(content.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257, 6, "ascii"); header.write("00", 263, 2, "ascii");
    header.write(header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
    chunks.push(header, Buffer.from(content), Buffer.alloc(padding(content.length) - content.length));
  }
  chunks.push(Buffer.alloc(2 * block));
  const bytes = gzipSync(Buffer.concat(chunks), { level: 9 });
  return { bytes, sha256: digest(bytes) };
}

export function readCoreArchive(bytes: Uint8Array, expectedSha256: string): CoreArchive {
  CoreArtifactHashSchema.parse(expectedSha256);
  if (bytes.length > CORE_ARCHIVE_LIMITS.totalBytes) throw new Error("压缩包超过大小上限");
  if (digest(bytes) !== expectedSha256) throw new Error("Core压缩包SHA-256与锁定摘要不一致");
  const tar = gunzipSync(bytes, { maxOutputLength: CORE_ARCHIVE_LIMITS.totalBytes });
  const files = new Map<string, Uint8Array>();
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let offset = 0, ended = false;
  const text = (header: Buffer, start: number, size: number) => {
    const field = header.subarray(start, start + size), end = field.indexOf(0);
    if (end >= 0 && !zero(field.subarray(end))) throw new Error("USTAR文本字段包含隐藏尾部内容");
    return utf8.decode(end < 0 ? field : field.subarray(0, end));
  };
  while (offset + block <= tar.length) {
    const header = tar.subarray(offset, offset + block);
    if (zero(header)) {
      if (offset + 2 * block > tar.length || !zero(tar.subarray(offset))) throw new Error("USTAR结束块不完整");
      ended = true; break;
    }
    if (files.size >= CORE_ARCHIVE_LIMITS.files) throw new Error("Core包文件过多");
    if (header.toString("ascii", 257, 263) !== "ustar\0" || header.toString("ascii", 263, 265) !== "00")
      throw new Error("首版Core包只支持标准USTAR普通文件");
    const number = (start: number, size: number) => {
      const raw = header.toString("ascii", start, start + size).replace(/\0.*$/, "").trim();
      if (!/^[0-7]+$/.test(raw)) throw new Error("USTAR数值字段格式错误");
      return Number.parseInt(raw, 8);
    };
    const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    if (number(148, 8) !== checksum) throw new Error("USTAR头摘要不符");
    if (![0, 48].includes(header[156]) || !zero(header.subarray(157, 257)))
      throw new Error("Core包不能包含目录、软硬链接或扩展记录");
    const length = number(124, 12), start = offset + block, end = start + length;
    if (length > CORE_ARCHIVE_LIMITS.fileBytes || start + padding(length) > tar.length) throw new Error("USTAR文件越界或过大");
    const prefix = text(header, 345, 155), name = text(header, 0, 100);
    const file = prefix ? `${prefix}/${name}` : name;
    if (files.has(file)) throw new Error("Core包存在重复路径");
    files.set(file, tar.subarray(start, end));
    if (!zero(tar.subarray(end, start + padding(length)))) throw new Error("USTAR文件填充区含额外内容");
    offset = start + padding(length);
  }
  if (!ended || tar.length % block) throw new Error("USTAR包未完整结束");
  names([...files.keys()]);
  return { files, sha256: expectedSha256 };
}
