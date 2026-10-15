# 原报价场景的目录来源重开

接续784f779c，只在原facts/composition/request-bound根增加readQuoteCatalog，不新建服务类/公开DTO/HTTP/runner。主线明确授权局部映射，未碰settingsChanges/政策/公共模型。

实际入口：composeRequestBoundOriginalScenes.readQuoteCatalog及既有full-model根同名方法→AiOriginalSceneFactsService→原quote_clarification请求/当前grant→实际catalog.read(原闭合limit/id/精确name/cursor)→同query再读→原请求/当前身份复验。返回原page、可重开reference、observed或changed_reconfirmation_required。选择/报价/库存/执行全部未发生，不能把目录重开当作人类确认。

expectedConfigurationVersion与expectedPageFingerprint必须成对；指纹包含query、scope/audience、完整最少items、pageversion、截断/nextCursor/source，排除纯观察时间。不同query/游标不能仅因DB pageversion相同就说同一页；商品名称改变而版本未更新也会触发重确认。同query读取期间变化拒绝，不返回混合页。每个目录read最多100，未无限翻页；原请求授权内部仍复用既有准备链，不能称整条授权/quote context均DB分页。

一次inline实际request-root→当前Auth/Guard→原请求仓储→Core/config仓储目录。仅DB delegate/基础配置来源合成：初次observed、原reference重开observed，直接改变DB row名称（不改updatedAt）得到changed_reconfirmation_required；额外actor字段和撤session拒绝，step0，无模型/报价/选择。exit0。必要Compiler API noEmit0诊断/exit0，diffcheck0，无tests/fixtures新增修改，直接断言无TAP计数。命令为原双preload node -e（ts-node非transpileOnly）、固定无效DATABASE_URL及本树绝对write-root/audit/TEMP/TMP，audit=output/ca-business-bounded-20261014.audit。

通知分区核查：RentalBusinessService.tenantReadiness当前仅workspace_profile/accounts_roles/fulfillment_network/business_rule/business_calendar/item_groups/pricing_groups_rates/price_version/membership_base九键，没有notification检查键。主线765beeb5已提供prepareChanges及receipt、同Module原Task接点，但不等于有开业notification→原settings命令映射；需主线明确正式scene/section关联后才接。本片不把business_rule或workspace_profile偷映射为通知写入，其他分区继续prepared_not_submitted。原提案/审批/原结果reader直接复用，不复制状态机。

未验：真实HTTP/MySQL/模型/设备/生产，全部cursor/截断竞态矩阵。本片仅服务器可调用消费者；公开schema/routes/runner原port接线已由主线认领，不以本片声称AIN完整。源码无跨树写入，output与原资源保留不提交。
