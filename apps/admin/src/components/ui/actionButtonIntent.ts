/** Shared idle-icon semantics. Explicit intent wins; unknown commands stay text-only.
 * Match action prefixes, never words inside a receipt/review label (e.g. “核对保存结果”). */
export type ActionButtonIntent = "save" | "refresh" | "retry" | "review" | "search" | "connect"
  | "create" | "upload" | "download" | "submit" | "confirm" | "cancel" | "stop"
  | "next" | "previous" | "forward" | "select" | "play" | "notify" | "edit" | "delete" | "undo" | "none";

const rules: ReadonlyArray<readonly [ActionButtonIntent, RegExp]> = [
  ["stop", /^(?:停止|Stop\b)/iu],
  ["cancel", /^(?:请求取消|取消|Cancel\b|Request cancellation\b)/iu],
  ["connect", /^(?:测试连接|检测连接|连接失败|Test (?:the )?connection\b|Check connection\b|Connection failed\b)/iu],
  ["refresh", /^(?:刷新|自动刷新|重新读取|重读|Refresh\b|Reload\b|Re-read\b|Live updates\b)/iu],
  ["retry", /^(?:重试|Retry\b|Try again\b)/iu],
  ["review", /^(?:核对|人工核对|审阅|检查|读取|只读|查看|Review\b|Read\b|Load\b|View\b|Inspect\b|Check\b|Reconcile\b|Observe\b)/iu],
  ["search", /^(?:搜索|检索|识别|获取模型|Search\b|Find\b|Detect\b|Get models\b)/iu],
  ["save", /^(?:保存|Save\b)/iu],
  ["upload", /^(?:导入|上传|Import\b|Upload\b)/iu],
  ["download", /^(?:导出|下载|Export\b|Download\b)/iu],
  ["previous", /^(?:上一页|上一步|Previous\b|Back\b)/iu],
  ["next", /^(?:下一页|下一步|Next\b)/iu],
  ["forward", /^(?:进入|登录|Log in\b|Sign in\b|Enter\b|Continue\b)/iu],
  ["select", /^(?:选择|Select\b|Choose\b)/iu],
  ["notify", /^(?:通知|Notify\b)/iu],
  ["undo", /^(?:撤销|Undo\b|Revoke\b)/iu],
  ["delete", /^(?:删除|Delete\b|Remove\b)/iu],
  ["create", /^(?:新增|新建|创建|添加|生成|准备|Add\b|Create\b|Generate\b|Prepare\b)/iu],
  ["submit", /^(?:提交|发送|Submit\b|Send\b|Request\b|Apply\b)/iu],
  ["confirm", /^(?:确认|确定|批准|采用|Confirm\b|Approve\b|Accept\b|Grant\b|Adopt\b|OK$)/iu],
  ["edit", /^(?:编辑|修改|更新|Edit\b|Update\b)/iu],
  ["play", /^(?:运行|执行|继续|Run\b|Execute\b|Resume\b)/iu],
];

export function resolveActionButtonIntent(label: string, fallback: ActionButtonIntent = "none"): ActionButtonIntent {
  const text = label.trim();
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? fallback;
}
