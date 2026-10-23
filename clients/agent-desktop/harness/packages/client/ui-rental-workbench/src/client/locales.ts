/** Localized desktop-workbench controls; business labels arrive from the original admin projection. */
export const zh = {
  space: '经营空间', mode: '工作方式', ai: 'AI', traditional: '传统', platform: '平台管理面', noSpace: '尚无经营空间',
  logout: '退出登录', retry: '重新连接', unavailable: '后台暂不可用，请重新连接', noPages: '暂无可访问页面',
  failed: '操作未完成，请先保存页面并核对登录和经营空间；结果不明时请重新连接，不要重复操作', completed: '请求已处理，以当前页面和经营空间为准', business: '业务后台',
}
export type RentalWorkbenchKey = keyof typeof zh
export const en = {
  space: 'Business workspace', mode: 'Work mode', ai: 'AI', traditional: 'Traditional', platform: 'Platform administration', noSpace: 'No business workspace',
  logout: 'Sign out', retry: 'Reconnect', unavailable: 'Admin is unavailable. Reconnect to continue.', noPages: 'No accessible pages',
  failed: 'Action not completed. Save your page and check your login and workspace. If the result is unknown, reconnect; do not repeat the action.', completed: 'Request handled. Check the current page and workspace.', business: 'Business administration',
} satisfies Record<RentalWorkbenchKey, string>
