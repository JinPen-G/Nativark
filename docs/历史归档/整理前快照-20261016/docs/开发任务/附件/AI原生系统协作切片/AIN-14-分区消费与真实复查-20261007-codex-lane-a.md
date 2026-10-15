# AIN-14 分区消费与真实复查

接续fd17b9b6；只补原openingActions，不另建诊断系统。

- `openingActions.read()`现在投影原Core配置中的商品id/code/status/inventoryMode/unit、计价币种/单位/分组id/version、履约模式和地点id/code/status/capabilities，带scope/configVersion/观察时间。各列表100上限并明确truncated，非DB查询有界性证明；不返回原始设置/凭据/账号。库存模式不代表实际库存，physical inventory显式not_loaded。原诊断授权拒绝受限data/location scope聚合，不为流程放宽。
- `openingActions.recheck({key})`重读原Core配置和tenantReadiness。当前正式检查通过才resolved；当前问题仍存在still_exists；未返回检查项/来源不可用/未知类型cannot_determine。消失不是修复证据，检查通过不是连接验真/已发布/所有分区原子保存。不接受用户fixed声明，不扫后台或建新表。
- `openingActions.prepare(value,modelAvailability?)`产同一有界深冻结payload和指纹，供主线AIN14模型步骤读取。模型不可用仍facts_only，不生成提案/审批或活动配置写入；保留明确外部验真、草稿和库存来源缺口。

固定无效DATABASE_URL；本树绝对audit=output/lane-a-opening-consumption.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-opening-consumption.test.cjs`
2pass/0fail/0skip/0todo、exit0，实际组合/Core/readiness/Guard，DB替身。类型audit=output/lane-a-opening-consumption-types.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`
exit0，diff check exit0。未跑全矩阵、MySQL、HTTP、模型、支付、浏览器/设备；分区权限细化源、外部证据、正式草稿入口仍待主线，不计AIN14整项完成。
