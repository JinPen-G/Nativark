/** 独立公共库初始化命令。显式执行才连接，口令只从进程读取且不输出，退出总是关闭本Client。 */
import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { initializePublicPlatform } from "@rental-os/platform-server";
import { PrismaClient } from "../generated/client";

async function initialize() {
  const password = process.env.SEED_PLATFORM_PASSWORD;
  if (!process.env.DATABASE_URL?.trim() || !password) throw new Error("须配置独立DATABASE_URL及SEED_PLATFORM_PASSWORD");
  const database = new PrismaClient();
  try {
    const result = await initializePublicPlatform(database, password);
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally { await database.$disconnect(); }
}

void initialize().catch(error => {
  // 仅公布输入约束或稳定驱动错误码；原连接串和口令不进入控制台。
  const code = error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "storage_unavailable";
  const reason = error instanceof HttpException ? error.message : code;
  process.stderr.write(`公共初始化失败：${reason}。核对独立数据库及迁移，未完成不能视为已创建。\n`);
  process.exitCode = 1;
});
