/** 公共设置/编辑页的草稿同步与离页保护，不替代服务端并发和原操作结果核对。 */
export { useServerFormSync } from "./app/useServerFormSync";
export { formSnapshotFingerprint, notifyFormSaved } from "./app/serverFormSnapshot";
export { UnsavedChangesGuard } from "./components/UnsavedChangesGuard";
export { SettingsReferenceUnavailable, readSettingsReference, retainSettingsReference, clearSettingsReference } from "./operation-reference";
export type { SettingsReferenceStorage } from "./operation-reference";
