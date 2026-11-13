# 租户官网本地验收入口

2026-11-13，租户官网重设计分支。完整阶段依据、验证和后续业务缺口见[开发记录](../../docs/预约网站/预约网站-开发记录.md#tenant-redesign-delivery-20261113)。

## 打开网站

当前预览为 [多品类官网](http://127.0.0.1:4194/?tenant=multiple)，另有[单品类](http://127.0.0.1:4194/?tenant=single)和[双品类](http://127.0.0.1:4194/?tenant=double)。演示品牌一程租赁及视觉方向由本任务自主选择。

从首页查询开始，依次查看目录、详情、预约、我的租赁、账户、门店和帮助。验收浏览器保留两条本地演示预约，可核对门店自取和配送结果。演示登录、短信、地址保存和支付按实际能力呈现。

## 当前证据

| 证据 | 范围 |
| --- | --- |
| [首屏](.impeccable/review/desktop-first-viewport.jpg) | 1280×720 中文浅色，完整查询按钮可见 |
| [桌面首页](.impeccable/review/desktop.jpg) | 1280px 页面完整结构 |
| [手机首页](.impeccable/review/mobile.jpg) | 390×844，查询先于场景照片 |
| [平板首页](.impeccable/review/tablet.jpg) | 768×1024 |
| [窄屏指南](.impeccable/review/narrow.jpg) | 320×760 英文深色 |
| [商品目录](.impeccable/review/catalog.jpg) | 搜索、分类与商品摄影 |
| [商品详情](.impeccable/review/detail.jpg) | 租期、数量及商品说明 |
| [预约](.impeccable/review/booking.jpg) | 联系人、门店与费用核对 |
| [订单](.impeccable/review/order-mobile.jpg) | 本地配送预约结果 |
| [账户](.impeccable/review/account-mobile.jpg) | 地址表单展开 |
| [电钻信息修复](.impeccable/review/drill-detail.jpg) | 通用名称和待确认型号、电压 |
| [浏览器记录](.impeccable/review/browser-checks.json) | 46个页面及状态，4种宽度，交互与隔离响应检查 |
| [设计复核](.impeccable/review/finish-review.json) | 全量截图复核、素材信息修复及修复项复验 |
| [单次检测原结果](.impeccable/review/detector.json) | 87项旧设计文档对齐提示 |

整页截图保留内容宽度，部分视口的10px滚动条区域未进入图片。首屏截图另按1280×720精确保存。当前截图已逐张打开核对。

## 验证范围

类型检查、216次离线组件渲染、9项 favicon、19项定向行为检查及 `ai-offline` 生产前端构建均通过，退出码均为0。内置浏览器的46个页面及状态记录未发现文档横向溢出，最终首页重新加载后无控制台错误。

独立设计复核先要求修正电钻照片与型号的矛盾，修正后对这一项给出 `resolved` 和 `ship`。该结论只覆盖其修复项。外部风格目录的 QUALITY BAR 卡片未能取得，设计参考使用实际浏览的 Saaspo 页面。

[设计规范](DESIGN.md)和[设计 sidecar](.impeccable/design.json)已根据当前源码更新，含实际设计 tokens 与10个组件样例。已完成语法、源码值和链接核对，样例在设计面板内的渲染尚未验证。

构建保留约735.13kB入口包提示，gzip约205.94kB。真实认证、短信、库存、报价、订单、数据库、支付、企业与 AI 后端、微信宿主和部署仍待对应专项联调验收。WEB正式任务按原门槛维护。
