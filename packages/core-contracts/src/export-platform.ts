/** 开发者离线导出固定提交的零 Core 底座源码包；不安装、部署或改变当前组合。 */
import { lstat, open, readFile, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { resolve } from "node:path";
import { packPlatformSource, readPlatformSourceFromGit } from "./platform-source";

export async function exportPlatformSourceCommand(args: string[]): Promise<void> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--repo", "--repository", "--commit", "--out"].includes(key) || !value || options.has(key))
      throw new Error("用法: export-platform --repo <Git目录> --repository <GitHub仓库URL> --commit <完整SHA> --out <新.tgz文件>");
    options.set(key, value);
  }
  if (["--repo", "--repository", "--commit", "--out"].some(key => !options.has(key))) throw new Error("底座导出须提供固定来源、提交和新输出文件");
  const source = await readPlatformSourceFromGit(resolve(options.get("--repo")!), {
    repository: options.get("--repository")!, commit: options.get("--commit")!
  });
  const archive = packPlatformSource(source), output = resolve(options.get("--out")!);
  const file = await open(output, "wx");
  let identity: Stats | undefined;
  let offset = 0;
  async function matchesWrittenBytes(): Promise<boolean> {
    const current = await lstat(output);
    if (!identity || !current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino
      || current.birthtimeMs !== identity.birthtimeMs || current.size !== offset) return false;
    return (await readFile(output)).equals(archive.bytes.subarray(0, offset));
  }
  try {
    try {
      identity = await file.stat();
      while (offset < archive.bytes.length) {
        const { bytesWritten } = await file.write(archive.bytes, offset, archive.bytes.length - offset);
        if (!bytesWritten) throw new Error("底座源码归档写入未前进");
        offset += bytesWritten;
      }
    } finally { await file.close(); }
  } catch (failure) {
    // 完整写出但关闭失应答时保留原归档；部分写入只清理可确认的原文件。
    if (identity && offset < archive.bytes.length) {
      try {
        if (await matchesWrittenBytes()) await unlink(output);
      } catch (cleanup) {
        if ((cleanup as NodeJS.ErrnoException).code !== "ENOENT")
          throw new AggregateError([failure, cleanup], "底座源码归档写入失败，无法确认清理结果");
      }
    }
    throw failure;
  }
  if (!(await matchesWrittenBytes())) throw new Error("底座源码归档的输出身份或内容变化");
  console.log(JSON.stringify({ output, version: source.version, source: source.source, files: source.files.size, bytes: archive.bytes.length, sha256: archive.sha256 }));
}

if (require.main === module) exportPlatformSourceCommand(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
