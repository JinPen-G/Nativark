/** 显式运行才启动双 Core API，导入时可核模块和启动接线。 */
import { bootstrapMultiCore } from "./bootstrap";

if (require.main === module) {
  void bootstrapMultiCore().catch(error => {
    process.stderr.write(error instanceof Error
      ? `${error.name}: 双 Core API 启动失败\n`
      : "双 Core API 启动失败\n");
    process.exitCode = 1;
  });
}
