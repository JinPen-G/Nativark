# AIN-19 LB06：受权人工草稿与上传证据权威绑定

接续固定99438903，不追主线活动HEAD。保留Knowledge module WIP与output。主线已确认本线独占staff-uploads.controller.ts最小兼容接线和inspection-assist目录；原上传文件作者固定45cee878，存储runtime最近55fe87be，本片未改存储runtime。

## 实际生产者与消费者

`composeInspectionAssist({guard,credentials,core,db})` 装配真实Prisma仓储、原Auth/Guard的当前身份/订单ALS授权、InspectionActionAuthority、PrismaInspectionEvidenceAuthority、InspectionDraftService。无db时不注册草稿/证据服务；无默认成功桩，不接AppModule/员工UI，不启服务。

- `drafts.create/edit/read/list/receipt/saveCandidates`。人工无需Gateway即可保存不完整字段；保留0、未知字段和非法枚举/读数拒绝，原人工字段验证器继续复用。保存需当前对应阶段动作权或operate，不因GET可见就可保存；绑定需对应阶段凭证权。所有外部输入strict，不接受scope/owner/confirmed。
- 编辑支持manual/accepted/modified/rejected，保留候选与最终值的candidateId/actorId关系；采用再次经过原严格候选消费者。候选批在首次await前冻结，旧候选ID不复写；候选只追加、设reviewRequired，不能覆盖人工字段。保存候选仍标caller_supplied_not_model_execution_proof，未声称模型执行。
- 详情读取按当前scope/owner/audience和订单权限；await后原授权链再次确认。资源/模板/附件变化保留历史并标reviewRequired；写入拒绝跨对象迁移。30天expiresAt后停止编辑；最多1000revision及100候选/证据，列表仓储take≤50。收据保留，不自动清理未知提交。
- `evidence.bind` 从当前订单实际allocation/asset和冻结模板产生绑定，重读当前身份/阶段地点。附件必须是当前actor真实已完成uploadSession、active FileAsset、原订单及对应阶段scene，排除local_mock。新附件revision关联持久存储对象指纹；客户端checksum/URL/自由metadata不是内容证明。
- `StaffUploadsController.bindInspectionEvidence` 为上传完成后的显式新绑定入口；先运行原scenePermission/assertOwnerInScope，再调用生产绑定服务，原创建/完成/下载逻辑保留。依赖缺失返回unavailable。**未修改Guard或员工白名单；新路由尚需主线显式opt-in组合和现有白名单归属方接线，不能声称HTTP已可调用。** 服务组合可离线直接消费。
- 人工photo必须已有该功能绑定并列入草稿evidence；旧附件不自动升级。candidate.verify需要真正contentHash/mediaType/尺寸或时长；本片不采信FileAsset声明mime为识别证明，内容未读取时明确STORAGE_UNAVAILABLE。

## 快检

命令 `node --test tests/ai-native-inspection-persistent-application.test.cjs tests/ai-native-inspection-assist-template.test.cjs`；11 pass/0 fail/0 skip/0 todo，exit0。实际AuthService/ApiAuthGuard、服务、composition和Prisma仓储及新上传Controller经ts-node transpileOnly:false加载。DB/Core/已完成存储记录为离线替身，无真实MySQL、存储、模型、设备、微信验证；不冒称真实锁隔离/HTTP验收。

DATABASE_URL固定mysql://offline:offline@127.0.0.1:1/rental_os_offline；绝对preload/runtime；AI_OFFLINE_AUDIT=本树output/inspection-lb06-audit.log；TEMP/TMP=本树output/inspection-lb05-tmp。

## 边界及接续

Runtime仅调用上述业务入口，保持operation/expectedRevision/target身份和晚到候选隔离，不可把人工编辑当AIN07审批。Provider SDK独立在主线唯一Gateway替换，绑定服务与草稿state不含SDK消息/checkpoint、密钥、URL或媒体正文。回退保留候选、人工值和原收据，不重做Core检查。

下一片补有界媒体消费者/不可变识别准备与最终检查材料/原action精确恢复。当前缺非URL受控存储生产端口；现readKnowledgeBytes内fetch签名URL不能借用作本任务媒体入口。原Controller `createInspection` 内仍有原证据/幂等/费用边界，不能直调Core替代；精确交接必须保留该合法边界，旧replay读取latest inspection不能冒充原action精确收据。
