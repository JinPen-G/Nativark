/** 安装和固定包读取共用的普通目录边界；不创建、删除、移动目录或跟随链接。 */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function ordinaryPackageDirectory(directory: string): string {
  const absolute = resolve(directory);
  let current = absolute;
  while (true) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("部署目录须为不经过链接的普通目录");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return realpathSync(absolute);
}
