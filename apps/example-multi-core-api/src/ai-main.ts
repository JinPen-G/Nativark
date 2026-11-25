/** 显式运行沿原 AI 出口启动双 Core 宿主，配置、请求身份和退出排空由原入口维护。 */
import { bootstrapRentalComposition } from "@rental-os/rental-api/ai-app-module";
import { multiCoreAiApplicationModule } from "./ai-app.module";

if (require.main === module) {
  void bootstrapRentalComposition("enabled", lock => multiCoreAiApplicationModule(lock)).catch(error => {
    process.stderr.write(error instanceof Error
      ? `${error.name}，双 Core AI API 启动失败\n`
      : "双 Core AI API 启动失败\n");
    process.exitCode = 1;
  });
}
