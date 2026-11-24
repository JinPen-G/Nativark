/** 显式 AI + MCP 启动接点，复用同一所选根、数据库、Auth/Native/Core 与原 OAuth 工厂。
 * 默认/普通 AI 入口不导入此文件；只接受宿主源码中的受控工厂，不解析请求或环境里的模块路径。
 * 入口在 Nest body parser 前挂载，退出先等待 MCP，再销毁 Native 和唯一数据库。 */
import { ConfigService } from "@nestjs/config";
import type { McpRoutedHost } from "@rental-os/mcp-server/host-router" with { "resolution-mode": "import" };
import { RentalDatabaseClient } from "./database";
import { createRentalAiHostModule, RENTAL_HOST_ASSEMBLY, type RentalAiModuleOptions } from "./ai-app.module";
import type { RentalAiHostAssembly } from "./ai-assembly";
import { bootstrapRentalComposition } from "./bootstrap";
import { createRentalMcpHttpContribution } from "./mcp-composition";
import { createRentalOriginalMcpHost, type RentalOriginalMcpHostSources } from "./mcp-host";

// 扩展模块与启动入口取得同一 dist-mcp 中的令牌和类，避免跨构建目录混用实例。
export { RENTAL_HOST_ASSEMBLY, createRentalAiHostModule } from "./ai-app.module";
export type { RentalAiModuleOptions } from "./ai-app.module";
export type { RentalAiHostAssembly } from "./ai-assembly";
export { RentalDatabaseClient } from "./database";
export { createRentalMcpHttpContribution } from "./mcp-composition";

export interface RentalAiMcpHostDependencies {
  database: RentalDatabaseClient;
  configuration: ConfigService;
}

export interface RentalAiMcpSelection<Additional = unknown> {
  cores?: Omit<RentalAiModuleOptions<Additional>, "lock">;
  createOriginalHost(host: RentalAiHostAssembly<Additional>, dependencies: RentalAiMcpHostDependencies):
    McpRoutedHost | Promise<McpRoutedHost>;
}

/** createOriginalHost 应使用 rental-mcp-host 的原工厂和同一 host/database，不构造第二套业务图。 */
export function bootstrapRentalAiMcp<Additional = unknown>(selection: RentalAiMcpSelection<Additional>) {
  if (typeof selection?.createOriginalHost !== "function")
    throw new TypeError("MCP 选装须提供原 OAuth/Native 同实例工厂");
  return bootstrapRentalComposition("enabled", lock => createRentalAiHostModule({ ...selection.cores, lock }), {
    createIngress: async application => {
      const host = application.get<RentalAiHostAssembly<Additional>>(RENTAL_HOST_ASSEMBLY);
      if (!host.ai || !host.aiAccess) throw new Error("MCP 选装缺少同实例 AI 与数据准入");
      const dependencies = {
        database: application.get(RentalDatabaseClient), configuration: application.get(ConfigService),
      };
      const ingress = await createRentalMcpHttpContribution(host, {
        createOriginalHost: current => selection.createOriginalHost(current, dependencies),
      });
      if (!ingress) throw new Error("MCP 选装缺少原 HTTP 入口");
      return ingress;
    },
  });
}

/** 已审定原owner交给同一具体工厂；Node源码入口须在顶层显式调用本函数。 */
export function bootstrapRentalOriginalAiMcp<Additional = unknown>(sources: RentalOriginalMcpHostSources,
  cores?: Omit<RentalAiModuleOptions<Additional>, "lock">) {
  if (typeof sources?.metadata?.read !== "function" || typeof sources.catalog?.publication?.allows !== "function"
    || typeof sources.catalog?.release?.project !== "function" || typeof sources.catalog?.traffic?.current !== "function")
    throw new TypeError("MCP启动缺少已审定的AS/发布/字段/流量来源");
  return bootstrapRentalAiMcp<Additional>({ cores,
    createOriginalHost: (host, dependencies) => createRentalOriginalMcpHost(host, dependencies, sources) });
}
