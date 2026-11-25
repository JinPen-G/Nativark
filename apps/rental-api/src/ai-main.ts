/** 只有明确运行此入口才加载可选 AI Runtime；启动和退出沿同一原宿主生命周期。 */
import { bootstrapRentalComposition } from "./bootstrap";

export function bootstrapRentalAi() {
  return bootstrapRentalComposition("enabled", async lock => {
    const { RentalAiAppModule } = await import("./ai-app.module");
    return RentalAiAppModule.register({ lock });
  });
}

if (require.main === module) {
  void bootstrapRentalAi().catch(error => {
    process.stderr.write(error instanceof Error ? `${error.name}: Rental AI API 启动失败\n` : "Rental AI API 启动失败\n");
    process.exitCode = 1;
  });
}
