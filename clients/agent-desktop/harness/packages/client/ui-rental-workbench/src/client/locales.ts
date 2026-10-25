/** Localized desktop-workbench controls; business labels arrive from the original admin projection. */
export const zh = {
  space: '经营空间', mode: '工作方式', ai: 'AI', traditional: '传统', platform: '平台管理面', noSpace: '尚无经营空间',
  logout: '退出登录', retry: '重新连接', unavailable: '后台暂不可用，请重新连接', noPages: '暂无可访问页面',
  failed: '操作未完成，请先保存页面并核对登录和经营空间；结果不明时请重新连接，不要重复操作', completed: '请求已处理，以当前页面和经营空间为准', business: '业务后台',
  catalogPreview: '受控目录预览', catalogBoundary: '只在本机准备指定模型并读取获准目录引用，不发送业务材料给模型。目的地取自适配器实际准备结果，须符合当前空间政策；不读取普通聊天或自动执行。',
  provider: '政策允许的 Provider 标识', destination: '政策允许的 HTTPS Base URL', catalogRead: '读取当前目录', catalogLoading: '正在复核权限…',
  catalogDenied: '未取得目录。请检查当前权限、精确模型与协议许可、有效政策和模型配置；读取中配置变化时需重新核对。', catalogObserved: '查询时点', catalogReady: '当前可见的目录引用',
  catalogPolicyRevision: '政策修订', catalogExpires: '有效至', catalogMaterial: '核对最少业务材料（未发送）', catalogMaterialHash: '材料 SHA-256',
  catalogMaterialBoundary: '仅保留枚举事实、查询时点和配置版本；条目编号只对应本次返回，不可用于业务执行。未包含姓名、原始文本、内部对象编号、价格或库存；此预览不开放模型发送。',
  catalogModel: '用于本次准备检查的模型 ID', catalogInspectedRoute: '准备检查得到的初始模型路由',
  catalogInspectionBoundary: '未发送模型请求。此观察不证明重定向后的网络落点，也不授予模型或业务执行许可。',
  catalogEmpty: '当前查询未返回可见商品', catalogPartial: '当前结果已截断，不代表完整目录', enabled: '启用', disabled: '停用',
  catalogRequest: '目录查询条件（仅本机解析）', catalogSyntax: '支持“查看商品目录”或“查看前5条商品目录”。不支持客户信息、库存、价格或附加条件；不会把原文发送给模型。',
  catalogPreparedLimit: '本次读取上限', catalogDefaultLimit: '预览默认值，不是业务默认值', catalogExplicitLimit: '来自明确输入',
  catalogInputEmpty: '请输入支持的目录查询条件', catalogClarify: '请明确为仅目录查询，数量1至50；移除个人信息及未支持条件，或使用原业务页面。',
}
export type RentalWorkbenchKey = keyof typeof zh
export const en = {
  space: 'Business workspace', mode: 'Work mode', ai: 'AI', traditional: 'Traditional', platform: 'Platform administration', noSpace: 'No business workspace',
  logout: 'Sign out', retry: 'Reconnect', unavailable: 'Admin is unavailable. Reconnect to continue.', noPages: 'No accessible pages',
  failed: 'Action not completed. Save your page and check your login and workspace. If the result is unknown, reconnect; do not repeat the action.', completed: 'Request handled. Check the current page and workspace.', business: 'Business administration',
  catalogPreview: 'Controlled catalog preview', catalogBoundary: 'Prepare the selected local model and read authorized catalog references without sending business content to a model. The adapter-resolved destination must match current workspace policy. Ordinary chat and automatic execution are not used.',
  provider: 'Policy-approved provider identifier', destination: 'Policy-approved HTTPS base URL', catalogRead: 'Read current catalog', catalogLoading: 'Checking access…',
  catalogDenied: 'Catalog unavailable. Check current access, exact model/protocol permission, current policy and model configuration. Changes during a read require a fresh check.', catalogObserved: 'Observed at', catalogReady: 'Currently visible catalog references',
  catalogPolicyRevision: 'Policy revision', catalogExpires: 'Valid until', catalogMaterial: 'Review minimum business material (not sent)', catalogMaterialHash: 'Material SHA-256',
  catalogMaterialBoundary: 'Only enum facts, observation times and the configuration version are included. Item numbers belong to this response and cannot execute business actions. No names, raw input, internal object IDs, prices or inventory are included. This preview does not enable model sending.',
  catalogModel: 'Model ID for this preparation check', catalogInspectedRoute: 'Adapter-prepared initial model route',
  catalogInspectionBoundary: 'No model generation request was sent. This observation does not attest redirect targets or authorize model or business execution.',
  catalogEmpty: 'No visible products returned by this query', catalogPartial: 'Results truncated; not a complete catalog', enabled: 'Enabled', disabled: 'Disabled',
  catalogRequest: 'Catalog request (parsed locally)', catalogSyntax: 'Use "show catalog" or "show first 5 products". Customer details, inventory, prices and additional conditions are not supported. Raw input is not sent to a model.',
  catalogPreparedLimit: 'Read limit', catalogDefaultLimit: 'Preview default, not a business default', catalogExplicitLimit: 'Explicitly requested',
  catalogInputEmpty: 'Enter a supported catalog request', catalogClarify: 'Specify only a catalog query with 1–50 results. Remove personal details and unsupported conditions, or use the original business page.',
} satisfies Record<RentalWorkbenchKey, string>
