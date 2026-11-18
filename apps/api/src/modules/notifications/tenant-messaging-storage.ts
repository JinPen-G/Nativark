/** 新表尚未升级时明确报依赖缺口，避免把失败读取当成没有邀请或邮件。 */
import { ServiceUnavailableException } from "@nestjs/common";

export async function requireMessagingStorage<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    const failure = error as { code?: string; meta?: { code?: string } };
    if (failure.code === "P2021" || failure.code === "P2010" && failure.meta?.code === "1146") {
      throw new ServiceUnavailableException("邮箱邀请与客服数据表尚未升级，请联系管理员完成本版本数据库升级");
    }
    throw error;
  }
}
