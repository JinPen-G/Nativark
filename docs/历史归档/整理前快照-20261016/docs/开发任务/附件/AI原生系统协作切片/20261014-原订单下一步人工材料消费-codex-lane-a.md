# 原订单下一步的人工材料消费

接续2e2c134a。搜索确认原tools.orderManualHandoff已有，但原场景仅暴露prepareTaskMaterial/reopenCitation、没有将点选候选绑定原请求和当前订单版本的consumer；不新建next-step聚合器。

实际入口AiOriginalSceneFactsService.prepareOrderManualHandoff→composeAiOriginalScenes→composeRequestBoundOriginalScenes及既有full-model请求根同名方法。主线明确授权仅该映射，不碰settings创建活动函数。命令仅原inputRef/draftVersion、expectedOrderVersion和四个已有候选code的闭合枚举，不接受orderId/actor/scope/URL/任意工具。必须原问题为next_steps，按原受权订单最低字段读取→原tools.orderManualHandoff→再次订单及原请求身份/内容复验。过时订单版本拒绝，返回候选、原order资源引用与execution:not_attempted/approval:not_granted，不把权限码当Core allowed-actions，不审批/建单/退款/履约。

定向inline实际原request/原order Guard/ALS/最少facts/原next-step消费：正常manual_review、candidate.executable=false；stale版本、非法code和撤销会话拒绝，step零条。直接场景组合exit0；请求根映射的复验结果在提交前补记。数据库/配置来源为原离线事务替身，未替换Auth/Guard或手工塞成功handoff。必要Compiler API noEmit0诊断/exit0，tests/fixtures零修改；直接断言不按TAP计数。命令仍node双原preload -e、ts-node非transpileOnly、固定无效DATABASE_URL及本树绝对audit/write-root/TEMP/TMP，diffcheck另记实际退出码。

未注册新HTTP/按钮/worker/AppModule；需公开承载则由主线核对原公共合同，不能猜路由。未知原业务结果仍只能原receipt reader核对，本入口不调用提交/核对执行器；仅人工材料不能宣称正式办理或AIN整项完成。真HTTP/DB/模型/浏览器/设备/生产未验。

当前其他包直接复用：会员及本地支付的真实分页端口已接；Core商品配置全量map的最小端口需求已报告主线，缓存分页不冒称DB分页。开业普通字段before/after及单分区复查已存在，通用Core提案参与者缺失继续prepared_not_submitted，不借通知settings或order.commit执行。客户原页面接收与原提交读取已有2a9/f30正常离线证据，无自动建单；公开契约与真实环境仍归主线。

提交前请求根实际复验exit0：composeRequestBoundOriginalScenes.create/prepareTaskMaterial/prepareOrderManualHandoff，经当前Bearer→原Guard/ALS→原收据/订单→真实工具候选，正常/旧版本/非法code/会话撤销均满足断言。无新增测试文件；git diff --check exit0。仅暂存本片三份源码和此记录，原output不入提交。
