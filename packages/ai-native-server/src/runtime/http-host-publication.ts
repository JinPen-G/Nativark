/** 宿主实际挂载的请求工厂集合。只缩小目录可用性，不能替代原发布、权限或 Task 准入。 */
export const AI_NATIVE_HTTP_HOST_PUBLICATION = Symbol("AI_NATIVE_HTTP_HOST_PUBLICATION");
export interface AiNativeHttpHostPublication {
  isMounted(token: symbol | Function): boolean;
}
