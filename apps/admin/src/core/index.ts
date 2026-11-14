/** Core页面在当前React宿主中的正式适配出口；框架无关合同仍从core-contracts导入。 */
export { CorePage, CorePageHostProvider, useCorePageHost } from "./CorePage";
export type { CoreAdminPageAction, CorePageHost } from "./CorePage";
export { useCoreRequest } from "./useCoreRequest";
export { CoreTenantGrantPanel, CoreMemberAssignmentPanel } from "./CoreAccessPanel";
export { coreManagementApi } from "./management-client";
export { useCoreSession } from "./useCoreSession";
export { useCoreScope } from "./useCoreScope";
// 复用当前公共组件入口，Core无需导入宿主内部路径或复制交互实现。
export { Alert, Button, DataTableText, Form, Input, ListSection, SaveButton, Select, Table } from "@/components/ui";
export { QueryState } from "@/components/QueryState";
export { useLocale } from "@/app/locale";
export { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
