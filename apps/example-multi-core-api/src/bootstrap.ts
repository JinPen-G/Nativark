/** 双 Core 启动复用 Rental 原配置、请求身份、路由、Guard 作用域与退出排空。
 * 导入只声明入口，显式调用才读取进程配置和部署锁并启动宿主。 */
import { bootstrapRentalComposition } from "@rental-os/rental-api/bootstrap";
import { multiCoreApplicationModule } from "./app.module";

export function bootstrapMultiCore() {
  return bootstrapRentalComposition("disabled", multiCoreApplicationModule);
}
