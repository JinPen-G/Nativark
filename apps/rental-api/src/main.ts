/** 显式运行本文件才启动独立 Rental 宿主；离线检查导入 bootstrap，不运行 main。 */
import { bootstrapRental } from "./bootstrap";

if (require.main === module) {
  void bootstrapRental().catch(error => {
    // 不输出原错误对象中的凭据、业务正文或数据库连接参数。
    process.stderr.write(error instanceof Error ? `${error.name}: Rental API 启动失败\n` : "Rental API 启动失败\n");
    process.exitCode = 1;
  });
}
