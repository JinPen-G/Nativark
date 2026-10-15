# AIN-08 开业检查、经营风险：lane A 第三切片

基线24891d6f；两种投影在同一独立诊断文件，复用原服务，不创建运行器、HTTP入口或默认授权。

## 实现

AiOpeningReadFactsService：严格 limit 1–50，调用 RentalBusinessService.tenantReadiness，只投影 key/title/missing/optional 和 ready/missing/unavailable。去掉导航 URL、原始 summary/内部对象；不把会员依赖失败等同缺配置，不把部分配置当开业已就绪。

AiRiskReadFactsService：严格带时区起止、正区间最多31天及可选地点，调用 RentalWorkspaceReportRepository.getOperationReport。返回原金额、订单数、异常订单数和订单占用小时，明确 inventoryBasis=current_snapshot。profit=unavailable(cost_evidence_missing)，historicalUtilization=unavailable(historical_available_capacity_missing)，不由应收推利润或由当前库存推历史分母；不返回客户维度名称、成本、全部原报表。

响应 schema 验证 tenantId/workspaceId/币种；数量非负、有界，查询时点 observedAt 与报表 generatedAt 分开。输入不接受模型身份、场景授权或任意过滤字段。

## 权限与未完成装配（重要）

原开业入口 GET /rental/v1/tenant-readiness，原 Guard 接受 order:view、price:manage、system:user:manage、system:role:manage 中的既有权限口径。原经营入口 GET /rental/v1/reports/operations，report:view；原报表拒绝 own 的空间库存混读，并保留 selected 地点限制。

**现有 AiBusinessReadRouteAuthority 的封闭联合仅支持 catalog/availability/membership_candidates，缺正式 opening/risk bridge。本线没有修改公共鉴权入口。** 新服务必须注入 AiDiagnosticReadAuthority，其合同要求原 Guard/ALS 和读后当前身份/范围复核；没有该方法即 CONFIG_INVALID，不自动注册、不声称可执行。

测试中的授权装配是显式离线测试宿主，实际调用 ApiAuthGuard、AuthService 和 ALS，仅数据库/配置执行为替身；不是交付正式生产授权 adapter。主线需要在既有封闭 bridge 增加这两条固定原路由（不可由模型指定路径），按完整 actor/audience/scope/access 读后复核，再沿原计划政策/不可变输入/result/累计计量装配。本线不新造第二条执行链或恒真授权。成熟度为有界投影实现/离线原权限组合已验，生产装配 unavailable。

## 实际验证

红测 node --test tests/ai-native-lane-a-diagnostics.test.cjs：新模块尚未实现，测试文件加载失败，0 pass / 1 fail / 0 skip，退出1，**不记为8个行为红测**。

首轮绿测8/8，扩大15/15，再补读后地点缩权和完整 access 指纹，最终同命令16 pass / 0 fail / 0 skip，退出0。覆盖缺规则/服务依赖不可用、空报告、own拒绝、无权限、selected空集、跨租户/空间响应、读后换空间/缩地点、原仓储地点查询条件；调用实际业务/报表方法，不以夹具自证。

API tsc --noEmit 退出0；git diff --check退出0。Node均预加载本树 prisma-offline-preload.cjs、固定无效DATABASE_URL；AI_OFFLINE_AUDIT为本树绝对 output/lane-a-diagnostics-*.audit。无真库、HTTP、模型、浏览器、设备或生产验证；output不提交。待独立复核，不宣布AIN-08完成。

剩余：开业地点配置原入口是否应进一步按 selected 裁剪属于原权限/配置域决定；本线沿用原汇总，仅空集和变更拒绝，未声称原入口已具备逐地点配置隔离。原仓储成本/历史容量不存在，需主线独立事实建设，不能本线补造。诊断 unavailable 时人工原页面仍可使用。
