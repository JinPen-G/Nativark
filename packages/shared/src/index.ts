/**
 * 前后端共享契约的**唯一入口**。
 *
 * 本文件刻意只做再导出：所有引用方写 `@rental-os/shared`，
 * 声明搬到哪个域文件都不影响它们，因此拆分可以继续做而不引发一次大改。
 *
 * 依赖方向全部是 `import type`，运行时零耦合：
 *   infrastructure → platform → core，core → platform 只取一个类型。
 */
export * from "./common";
export * from "./core";
export * from "./platform";
export * from "./infrastructure";
export * from "./client";
export * from "./tenant-integrations";
export * from "./workspace-names";
export * from "./rental-rule-defaults";
export * from "./subscription";
export * from "./demo-request";
export * from "./client-rich-text";
export * from "./category-governance";
