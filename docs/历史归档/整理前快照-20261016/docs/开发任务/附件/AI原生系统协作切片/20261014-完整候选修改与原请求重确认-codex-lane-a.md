# 完整候选修改与原请求重确认

接续e35faa63，仅quote-candidate-preparation.service.ts。核原create/reissue/reconcileReissue及Core品类读取已串通，不新增包装或请求状态机。原reissue要求previousInputRef、新requestKey、同scene/owner/scope并增加原input revision；reconcileReissue按同key/previous/payload只读，不隐式重发。品类units/modes来自Core.category.businessModel与当前settings交集，有限日期语法继续租户timeZone，客户/商品/地点继续受权reader；corporate资格源缺失保持qualification_required，不降级个人。

## 确认缺陷及修复

实际红测：当前候选只改quantity且传旧selectionRevision，返回needs_confirmation，期待missing_input断言失败exit1。原正式confirmQuote另有inputFingerprint门，不等于本缺陷已能绕过审批或建单；问题是候选选择版本本身未绑定完整输入。

现selectionRevision增加完整candidateInput（仅剔除selectionRevision断言自身避免循环指纹），继续绑定原配置/页版本/会员/计价依据。数量、时间、商品、地点、履约、身份/付款和地址等候选修改不能静默沿用旧资源选择确认；旧版本明确要求reconfirm。无价格/库存/资格算法变化，不修改已保存quote或审批。

## 实际快检

- 同一inline实际Auth/Guard/Core/configRepo及候选服务，改qty旧版本红exit1→修后missing_input含selectionRevision，exit0。
- 原request-root正常：create→reviewReady→改qty带旧selectionRevision的reissue（新input rev2、previous绑定）→reconcileReissue读同input且不增加原记录→review返回重新确认→旧确认拒绝→新request明确新revision（rev3）→当前ready且qty2。原quote receipt仍unknown/quote0，撤session拒绝，step0，无模型/订单。exit0。DB/配置执行是原离线替身，实际原仓储/授权/准备未替换成结果桩。
- 必要Compiler API noEmit0诊断/exit0，git diff --check0，无新增修改tests/fixtures；非TAP断言不虚报套数。

命令沿node两原preload -e、ts-node非transpileOnly，固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；write-root/TEMP/TMP/audit全本树绝对路径，audit为output/ca-business-bounded-20261014.audit。不提交output或其他成果。

## 精确边界

本轮正常链用camera代表，未验证camping/vehicle/engineering全变体、所有时间/数量边界、企业资格真实生产源或四品类与人工报价完全一致。已有正式definitions/动态category读取并不替代这些验收。不连真DB/HTTP/模型/支付，不启用生产。开业通知无正式readiness键仍独立settings；通用分区无Core参加者继续prepared_not_submitted。局部缺陷修复不宣称原AIN完成。
