import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { registerRentalCapabilityHooks } from "@rental-os/rental-core/capabilities";
import { CapabilityHookRuntime } from "./capability-hook.runtime";

/**
 * 内置能力模块的登记入口。
 *
 * 为什么单独一个 provider 而不是让运行时自己 import 各能力模块：运行时只负责
 * 「按已启用实例、按确定性顺序执行」，不该知道有哪些具体能力存在。反过来，
 * 能力模块也不该自己找运行时注册（那会让登记时机取决于 import 顺序）。
 * 本 provider 在启动阶段调用 Rental 包的正式组合，新增实现沿该组合登记。
 *
 * 登记发生在 `OnApplicationBootstrap`：此时全部 provider 已就绪，
 * 且早于任何 HTTP 请求，因此不存在「第一个请求时 Hook 还没登记」的窗口。
 */
@Injectable()
export class CapabilityHookRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(CapabilityHookRegistrar.name);

  constructor(private readonly runtime: CapabilityHookRuntime) {}

  onApplicationBootstrap() {
    registerRentalCapabilityHooks(this.runtime);
    this.logger.log(`已登记 capability Hook：${this.runtime.registeredVersions().join("、")}`);
  }
}
