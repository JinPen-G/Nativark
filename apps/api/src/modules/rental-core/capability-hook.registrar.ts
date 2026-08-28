import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { buildCameraCompatibilityHookModule } from "./capabilities/camera-compatibility";
import { CapabilityHookRuntime } from "./capability-hook.runtime";

/**
 * 内置能力模块的登记入口。
 *
 * 为什么单独一个 provider 而不是让运行时自己 import 各能力模块：运行时只负责
 * 「按已启用实例、按确定性顺序执行」，不该知道有哪些具体能力存在。反过来，
 * 能力模块也不该自己找运行时注册（那会让登记时机取决于 import 顺序）。
 * 这里是唯一把两者接起来的地方，新增一个真实能力只需在下面追加一行。
 *
 * 登记发生在 `OnApplicationBootstrap`：此时全部 provider 已就绪，
 * 且早于任何 HTTP 请求，因此不存在「第一个请求时 Hook 还没登记」的窗口。
 */
@Injectable()
export class CapabilityHookRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(CapabilityHookRegistrar.name);

  constructor(private readonly runtime: CapabilityHookRuntime) {}

  onApplicationBootstrap() {
    // CAM-01A：摄影器材兼容性（仅摄影品类适用，由注册表的 applicableCategories 收口）。
    //
    // 规则行为变更时的做法：新增一个 `buildCameraCompatibilityHookModule("cam-2.0")` 并
    // **同时保留** cam-1.0 的登记，直到没有在途订单再引用它。登记表按
    // (code, implementationVersion) 索引，删掉旧版会让引用它的在途订单 fail-closed。
    this.runtime.register(buildCameraCompatibilityHookModule());
    // 发布自检：注册表当前声明的实现版本必须真的有实现。
    // 捕捉「升了注册表版本号却忘了发实现」——那会让该能力对新业务全面 fail-closed。
    this.runtime.assertCurrentVersionsRegistered();
    this.logger.log(`已登记 capability Hook：${this.runtime.registeredVersions().join("、")}`);
  }
}
