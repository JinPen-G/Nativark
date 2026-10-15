# Customer Rental Agent 原 checkout 转接消费

施工树 codex-ai-native-lane-a；分支 ai/codex-ai-native-lane-a-20261007。仅同步固定 af78c7c7f00d12aa13e206364374ad633cf854fc（已含网站3695039f），保留全部 output。认领原 pages/checkout/index.ts/wxml、components/ai-native/booking-handoff.ts、原 miniprogram-static.test.cjs 与本记录。不改 Core/createOrder/API/支付/shared/build/AppModule/路由。

## 功能与原接点

- 原 Page 实例提供 `attachHost(CustomerBookingHost)` / `detachHost()`；函数仅在实例 aiHost/aiConsumer 内存。没有 Function properties、WXML函数、事件detail、storage 或 URL 能力开关。
- 无显式 enabled host 时，原人工 checkout 保持 prepare、报价和同原键恢复流程；新增 AI 调用为零。enabled host 模式禁止原自动报价、prepare、提交/恢复入口；不把 AI 输入写到持久 cart，不能通过回退/解绑把它变成原人工可提交清单。
- 现有原页面不注册新路由。未来受权入口在取得原 Page 实例后显式 attachHost；host 包含当前服务器能力投影（tenantCode/serviceCode/customerId/tenantId/workspaceId/releaseRevision）、服务器 handoffRef、原 `readBookingHandoff({handoffRef})` request-bound Promise。没有通用 HTTP 路径推断。
- 人工读取→展示原 handoffRef/revision/expiresAt/quoteId/时区→人工继续重新读取一致材料→原已交付 `fetchQuote(quoteId)` GET。验证该报价本人/租户/个人身份、原起止、商品顺序数量、履约/地点/地址、有效期及金额，之后才填原页面日期/时间/履约与只读数量材料，显示原 payable/deposit/preAuth，不计算金额。
- 明确 not_reserved/original_booking_page_required；原报价不能被 createQuote 自动覆盖。提交按钮不可用，代码入口也禁用。报价读失败、材料变化、超期、不同调用关联、不可映射均 unavailable，不显示已受理。
- 支持最多20个不重复明确商品引用、整数数量1～999、个人同空间自取/配送。它们是显示上限，不是 Core 资格或库存判断；企业、服务行、无原商品关联、重复商品行等不能准确映射的情况拒绝，不自动合并或降级。
- 当前上下文来自原独立客户 session/contextVersion、包内 tenantCode、当前 serviceCode；客户端上下文不是服务器授权。当前 request-bound 服务必须继续原Guard复验。原 sessionEvents 变化立即清旧引用并解绑旧host；onHide销毁消费代次且清展示，onShow只重建私有消费者不自动读，onUnload销毁及取消订阅。返回栈需要重新人工读取。旧 Promise 不 setData；重复绑定不多订阅。
- 结果未知的原人工cart保留原恢复代码。本片不发 AI来源材料的提交，公共契约尚无 handoff→原Booking受理操作键/收据关联，不能借“查最新订单”核对，也不能复用其他cart提交键；该缺口交主线。

## 少量实际验证

DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_WRITE_ROOT本树，AI_OFFLINE_AUDIT本树output/mp-handoff-smoke.audit或mp-handoff-types.audit，TEMP/TMP本树output/entry-booking-tmp。所有 Node 预加载原 prisma-offline-preload.cjs。

命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-name-pattern='AI原checkout交接|页面 WXML|每个 WXML 事件|WXSS/WXML' tests/miniprogram-static.test.cjs`。

最终 pass=4/fail=0/skip=0/todo=0，退出码0。1项实际原 Page+消费者+原fetchQuote请求封装行为，3项原静态门禁。正常继续只GET原报价；默认无host无AI请求；原购物清单未被写入；禁止重报/提交；单在途/hide晚到/show无自动读取/session切换/同步抛错/unload验证。真实实现由旧runtime递归加载，替身只提供微信宿主、网络回复；不是复写页面业务逻辑。没有浏览器/微信宿主证据。

实际失败与修复：首次行为用例缺微信 Behavior 宿主替身，0pass/1fail/exit1；补最小Behavior注册替身后通过。静态首次wx:key=index非法，3pass/1fail/exit1；修稳定itemGroupId，并拒绝不能稳定映射的重复商品后通过。未删断言。

原命令 `node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs apps/miniprogram/scripts/build.cjs --check` 退出码1：既有 shared dist未导出正式已有AiBookingHandoff，TS2305。曾验证直接type-source引用会TS6059（rootDir），已恢复正式`import type ... from @rental-os/shared`，没有复制DTO或放宽原检查器。主线已确认并负责私有声明产物方案；本片不触碰共享生成物或build脚本。

辅助代码检查：TS API读取原miniprogram tsconfig，仅noEmit，rootDir本树/paths指向本树shared源，91个入口、0诊断、退出码0。此检查不等同原build/check通过，不掩盖前述阻塞。

`git diff --check`：退出码0。没有扩大全矩阵。

## 未接 / 未验

- 私有正式shared声明构建方案待主线固定提交；原build/check失败仍保留，尚未运行完整构建。
- 服务端能力发布与实际request-bound客户端host transport尚未启用；默认关闭，页面接点不是正式HTTP已接通。
- handoff→原createOrder关联键/受理收据/同原键查询缺正式合同；继续禁AI材料提交，不自动标submitted。
- 无真实DB/HTTP/模型/支付/微信开发者工具/设备验证、无生产启用；离线Page替身+静态+源码映射类型不等于AIN-22/专项验收。

## 固定声明修复接回后的原检查（追加，不抹去早期失败）

主线提供固定77c78a466ccaafdca2b3736b793d0645467cc3fb。本树保留4908a549成果后安全merge，合并点62ff3389908a6bbf04826595c93dc5924cb6768c，无冲突。未跟随移动HEAD，不复制主线产物，不修改主线公共脚本。

原脚本现使用本树output/miniprogram-shared-types-*私有声明，由本树shared源码生成，不写共享dist/node_modules；原小程序rootDir和运行时包依赖禁令保留。旧output和本轮私有声明目录均保留。

环境沿用上述离线值，另设置 `NODE_OPTIONS=--require="D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/tests/fixtures/ai-native/prisma-offline-preload.cjs"`，保证脚本子进程也预加载护栏。

- `node apps/miniprogram/scripts/build.cjs --check`：退出码0，原类型检查通过。
- `node apps/miniprogram/scripts/build.cjs`：退出码0，21页完整本机联调构建。执行前核实本树apps/miniprogram/dist不存在、不是其他树链接；本轮在本树自行生成，未复制他人产物。检查生成checkout与booking-handoff本地JS，正式类型导入已擦除、仅本地相对运行时依赖。
- `git diff --check`：退出码0。

因此前述“原check与完整build尚阻塞”在固定依赖接回后已解决；早期TS2305/TS6059仍是实际阶段失败。原Booking受理关联和服务器能力/transport未接仍不变，提交禁用。产物仅本地联调，未启动服务、网络、真实DB/模型/支付、微信开发者工具或设备，不可上传、不生产启用。
