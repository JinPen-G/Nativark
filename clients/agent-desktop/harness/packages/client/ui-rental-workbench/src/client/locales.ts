/** Localized desktop-workbench controls; business labels arrive from the original admin projection. */
export const zh = {
  space: '经营空间', mode: '工作方式', ai: 'AI', traditional: '传统', platform: '平台管理面', noSpace: '尚无经营空间',
  logout: '退出登录', retry: '重新连接', unavailable: '后台暂不可用，请重新连接', noPages: '暂无可访问页面',
  failed: '操作未完成，请先保存页面并核对登录和经营空间；结果不明时请重新连接，不要重复操作', completed: '请求已处理，以当前页面和经营空间为准', business: '业务后台',
  catalogPreview: '受控目录预览', catalogBoundary: '仅预览脱敏目录引用；不会发送模型，不含商品名称、库存或价格。目的地须已获当前租户政策允许，此处填写不代表模型实际已配置。',
  provider: '政策允许的 Provider 标识', destination: '政策允许的 HTTPS Base URL', catalogRead: '读取当前目录', catalogLoading: '正在复核权限…',
  catalogDenied: '未取得目录。请检查当前权限、有效政策及目的地配置，再重试。', catalogObserved: '查询时点', catalogReady: '当前可见的目录引用',
  catalogEmpty: '当前查询未返回可见商品', catalogPartial: '仅显示前 10 条，不代表完整目录', enabled: '启用', disabled: '停用',
}
export type RentalWorkbenchKey = keyof typeof zh
export const en = {
  space: 'Business workspace', mode: 'Work mode', ai: 'AI', traditional: 'Traditional', platform: 'Platform administration', noSpace: 'No business workspace',
  logout: 'Sign out', retry: 'Reconnect', unavailable: 'Admin is unavailable. Reconnect to continue.', noPages: 'No accessible pages',
  failed: 'Action not completed. Save your page and check your login and workspace. If the result is unknown, reconnect; do not repeat the action.', completed: 'Request handled. Check the current page and workspace.', business: 'Business administration',
  catalogPreview: 'Controlled catalog preview', catalogBoundary: 'Deidentified references only; not sent to a model. Names, inventory and prices are omitted. Enter a policy-approved destination; this does not configure or attest an actual model connection.',
  provider: 'Policy-approved provider identifier', destination: 'Policy-approved HTTPS base URL', catalogRead: 'Read current catalog', catalogLoading: 'Checking access…',
  catalogDenied: 'Catalog not available. Check current permissions, active policy and destination settings before retrying.', catalogObserved: 'Observed at', catalogReady: 'Currently visible catalog references',
  catalogEmpty: 'No visible products returned by this query', catalogPartial: 'First 10 entries only; not a complete catalog', enabled: 'Enabled', disabled: 'Disabled',
} satisfies Record<RentalWorkbenchKey, string>
