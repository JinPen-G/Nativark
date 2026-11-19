/** 开发者离线导出固定提交的零 Core 底座源码包；不安装、部署或改变当前组合。 */
import { open, unlink } from "node:fs/promises";
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
  let completed = false;
  try {
    await file.writeFile(archive.bytes);
    completed = true;
  } finally {
    try { await file.close(); }
    finally { if (!completed) await unlink(output); }
  }
  console.log(JSON.stringify({ output, version: source.version, source: source.source, files: source.files.size, bytes: archive.bytes.length, sha256: archive.sha256 }));
}

if (require.main === module) exportPlatformSourceCommand(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
