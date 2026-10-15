# 检查历史正式分页消费

开工实际05c287af，原A树/分支正确，tracked/index空、无MERGE_HEAD/CHERRY_PICK_HEAD。安全fast-forward主线指定9435d0bdbca36e1ae7a928d1bec64eaeaa14c0d4，祖先检查exit0后才改本片；不追移动HEAD，不动已合入fees或预算/B线成果，原output保留。

## 可调用功能

tools/order-inspection-facts.service.ts只需Core.getOrder/listInspectionsPage及原inspection资源Guard，不再要求旧listInspections。一次read只读原持久页limit50，不回退全量、不自动追加分页。核items/coverage/pagecursor、记录tenant/order/模板/版本、重复和32KiB最少投影；订单前后updatedAt与身份/地点原Guard复验继续保留。结果保持coverage:partial、pageCoverage:page_not_total，nextCursor非空明确truncated，不将首50条当完整检查历史。queryBound标persisted_core_page_limit_plus_one、queryLimit50/queryPages1；不称SQL总扫描量或JSON单行输入字节已被限制。

business-tools.composition按新port构造并绑定同reader。实际orderExplanation(含fees)/orderExplanationPreparation/scenes消费自动接回，reopenCitation(field:inspection_records)也复用同reader，不新增来源服务/DTO/HTTP。无分页port时inspection来源保持unavailable，不调用旧人工全量接口。附件仍not_loaded，不透传operator/rawresults/附件URL，不判责收费或提交检查。

## 验证

一次inline实际AuthService/ApiAuthGuard/ALS、RentalCoreService、RentalCoreFactRepository.listInspectionsPage/toInspectionRecord、业务fee scene与原citation重开；仅数据库delegate/基础配置源为合成离线边界。51条记录返回50/原inspection-049游标/truncated/page_not_total，生产查询确实带tenant/workspace/order和take51；费用材料与来源重开保持partial。只提供getOrder/page两方法的独立reader宿主成功；旧facts.listInspections刻意抛错且未触发；错订单原row拒绝，撤session拒绝且不再查检查表。exit0，非TAP不虚报测试总数。

必要Compiler API noEmit（原场景模块/client-request入口及依赖）0诊断/exit0，git diff --check0。未新增修改tests/fixtures。实际命令node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际page/Core/业务消费者断言>'、ts-node非transpileOnly；DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；write-root/TEMP/TMP/audit均本树绝对路径，audit=output/ca-order-source-20261015.audit。只提交两源码和此记录，不提交output。

未验真实HTTP/MySQL性能/并发/模型/设备/生产；原Core行JSON可能大、查询计划/总扫描不以limit证明有界。历史rule/template缺失仍按原缺失状态，不拿当前配置替代。通用开业分区/notification关联/企业独立资格仍缺正式源，由主线协调。本片仅当前正式原服务消费者，不改Core/公共权限/runner/审批/预算，保留Runtime/Provider替换边界，不宣称AIN完成。
