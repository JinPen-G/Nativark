/** 源码选装的 HTTP 入口在 Native/业务服务之前排空。
 * Nest 的默认信号钩子会直接销毁模块，因此选装入口使用同一 close 链处理信号。
 * 本文件不启动监听、连接数据库或将断线解释为业务回滚。 */
import { Logger, ShutdownSignal } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RentalBootstrapIngress {
  middleware(request: IncomingMessage, response: ServerResponse, next: () => void): void;
  close(): Promise<void>;
}

/** 调用者在注册 Nest 默认 shutdown hooks 之前安装，应用仍是原同一实例。 */
export function attachRentalBootstrapIngress(
  application: NestExpressApplication, ingress: RentalBootstrapIngress,
): void {
  // Nest 10 的实现接收 signal，公共接口仅暴露无参 close；保留原生命周期的信号传递。
  const closeApplication: (signal?: string) => Promise<void> = application.close.bind(application);
  const closeIngress = ingress.close.bind(ingress);
  const listeners = new Map<ShutdownSignal, () => void>();
  let closing: Promise<void> | undefined;
  let receivedSignal = false;

  const detachSignals = () => {
    for (const [signal, listener] of listeners) process.removeListener(signal, listener);
    listeners.clear();
  };

  const close = (signal?: string): Promise<void> => {
    return closing ??= Promise.resolve().then(async () => {
      // 失应答/取消只中止入口并等待原处理器返回；此时仍需原 Native 和数据库。
      await closeIngress();
      await closeApplication(signal);
      detachSignals();
    });
  };
  application.close = close;

  const shutdown = async (signal: ShutdownSignal): Promise<void> => {
    if (receivedSignal) return;
    receivedSignal = true;
    try {
      await close(signal);
      // 与 Nest 原信号行为一致，排空成功后恢复该信号的默认进程退出。
      process.kill(process.pid, signal);
    } catch {
      Logger.error("Rental HTTP 入口或应用未能正常排空", undefined, "RentalBootstrapIngress");
      process.exit(1);
    }
  };

  for (const signal of Object.values(ShutdownSignal)) {
    const listener = () => { void shutdown(signal); };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }
  application.use(ingress.middleware.bind(ingress));
}
