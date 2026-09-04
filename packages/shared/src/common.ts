/**
 * 与业务域无关的通用契约。
 *
 * 只放真正被所有域共用、且不属于任何一域的东西。原先 `ApiResult` 夹在历史门市域
 * 的末尾，会随那一层一起被删掉——而它是所有接口的信封，必须活得更久。
 */

export interface ApiResult<T> {
  data: T;
  requestId: string;
}
