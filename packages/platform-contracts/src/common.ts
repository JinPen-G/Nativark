/** 公共 HTTP 响应信封，所有宿主和业务 Core 共用。 */
export interface ApiResult<T> {
  data: T;
  requestId: string;
}
