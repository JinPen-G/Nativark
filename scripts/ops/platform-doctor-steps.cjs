'use strict';
/** 将诊断证据对应到原安装入口。只产生步骤说明，不持有执行器，不接受人工填报的成功状态。
 * 本地材料、数据库观察、显式写入和原结果回读分别列示；任何一步都不据此取得执行权。
 */
const API = 'apps/platform-api/README.md';
const HOST = 'packages/platform-core-host/README.md';
const CONTRACT = 'packages/core-contracts/README.md';

function installationSteps(report, { rootCommands, host }) {
  const selectedCore = report.profile === 'selected-core';
  const publicAi = report.profile === 'public-ai';
  const localChecks = report.checks.filter(check => check.required);
  const localIssues = localChecks.filter(check => check.state !== 'pass').map(check => check.id);
  const step = (id, actor, title, condition, entry, result, recovery, extra = {}) => ({
    id, actor, title, state: 'not_checked', condition, entry, result, recovery, ...extra,
  });
  const entries = selectedCore ? { generate: null, build: null, migrate: null, initialize: null, start: null }
    : rootCommands || publicAi ? {
      generate: 'npm run db:generate', build: 'npm run build', migrate: 'npm run db:migrate:deploy',
      initialize: 'npm run db:initialize', start: publicAi ? 'npm start' : 'npm run dev',
    } : {
      generate: 'npm run prisma:generate -w @rental-os/platform-api', build: 'npm run build -w @rental-os/platform-api',
      migrate: 'npm run prisma:migrate:deploy -w @rental-os/platform-api',
      initialize: 'npm run initialize -w @rental-os/platform-api', start: 'npm run start -w @rental-os/platform-api',
    };
  const steps = [
    step('materials', '部署者', '准备同一组合的本地材料',
      '选定固定源码、原锁和宿主；安装、生成及构建在已授权的独占环境执行。',
      selectedCore ? host + '/README.md' : API + '#默认零-core-的五步',
      '按原锁安装依赖、生成所选 Client、构建；再运行本诊断核对本地缺项。',
      '材料缺失或冲突先核固定来源，不覆盖在用 Client、依赖或原配置。',
      { state: localIssues.length ? 'needs-local-preparation' : 'local-checks-passed', checks: localIssues,
        commands: [entries.generate, entries.build].filter(Boolean) }),
    step('database-observation', '部署者', '确认目标库与原迁移账',
      '已明确目标环境、读取权限、所选数据所有者及该组合的物理观察入口。',
      selectedCore ? host + '/README.md' : API + '#显式安装与真实就绪',
      '区分空库、已迁移且兼容、未完成迁移和未知旧库；账号是否存在仍单独核验。',
      '读失败、旧账未知或物理结构不符时停止；不以文件、锁或进程存在判空库。',
      { state: report.database.checked ? report.database.state : 'awaiting-environment-observation', databaseState: report.database.state,
        commands: selectedCore ? [] : ['node scripts/ops/platform-doctor-install.cjs status --profile ' + report.profile] }),
    step('migration', '部署者', '显式应用已批准迁移',
      '目标库已经实际核定；所选组合原迁移链、备份及执行范围已批准。',
      selectedCore ? host + '/README.md' : API + (publicAi ? '#选装公共-ai-管理' : '#默认零-core-的五步'),
      '原迁移账与物理结构核同后才能进入初始化；命令退出成功不是账号或业务就绪。',
      '中断时先核原迁移记录和实际 DDL；unknown/failed 不重放、不重置库、不换初始链。',
      { state: 'awaiting-environment-observation', commands: entries.migrate ? [entries.migrate] : [] }),
    step('platform-account', '部署者', '显式初始化公共平台账号',
      '所选库迁移及物理结构已核定；首次初始化口令通过受控进程配置提供。',
      selectedCore ? host + '/README.md' : 'apps/platform-api/src/initialize.ts',
      '原命令返回 initialized:true 表示创建 platform/admin；initialized:false 表示核过既有主体。该结果不创建业务租户或 Core 授权。',
      '重复执行保留原口令、角色与授权，仅补录权限目录；主体异常时停止，不恢复账号。失应答先核原主体和审计，不自动重试。',
      { state: report.database.initialization?.state ?? 'not_checked',
        commands: selectedCore ? [] : ['node scripts/ops/platform-doctor-install.cjs initialize --profile ' + report.profile] }),
    step('platform-login', 'SaaS 管理员', '启动并验证平台登录',
      '运行配置、唯一 Client、数据与账号已核定，且已取得该环境启动许可。',
      selectedCore ? host + '/README.md' : 'apps/platform-admin/README.md#本地使用',
      '通过所选 API/Web 完成实际登录、首次改密与会话读取；健康响应和静态产物不代替登录。',
      '服务不可用先核本次启动结果；改密或业务响应未知时核原状态，不以重新初始化恢复。',
      { commands: entries.start ? [entries.start] : [] }),
    step('tenant-account', 'SaaS 管理员 → 租户管理员', '开通租户及独立租户账号',
      '当前 SaaS 会话具有原租户创建权限；目标租户和管理员已确认。',
      'packages/platform-server/src/modules/platform/README.md',
      '沿原租户创建入口创建租户及首个管理员，受控交付临时口令；租户管理员改密后使用自己的会话。',
      '创建失应答先读取目标租户及原审计，不能重复创建；平台管理员账号不替代租户业务身份。'),
  ];
  if (selectedCore) {
    steps.push(
      step('core-admission', '部署者 → SaaS 管理员', '核实际部署并登记 Core 准入',
        '原固定包已装配、数据就绪、权限定义已登记；SaaS 操作者仍须具有当前管理权限。',
        HOST + '#部署准入与存量切换',
        '先 readAdmission；仅首次缺记录且已核定时按原 operationId/expectedRevision 登记，再读当前修订及 readAdmissionOperation。',
        '已有 stopped 或其他修订保留；unknown 只核原操作，不默认开放、不重跑 Core 初始化。'),
      step('tenant-grant', 'SaaS 管理员', '向指定租户授予所选 Core',
        '部署准入和数据条件成立，当前操作者具备原租户管理权。', CONTRACT + '#core-管理-http-合同',
        '沿 readTenantGrant → tenantGrant → readTenantGrantOperation 核定当前授权和原修订。',
        '失应答读取原 operationId；停用、撤权和已记录的授权不能因重启或升级恢复。'),
      step('member-assignment', '租户管理员', '分配成员及业务角色',
        '租户已获该 Core，当前租户成员管理权限和数据范围符合原规则。', CONTRACT + '#core-管理-http-合同',
        '沿 readMemberAssignment → memberAssignment → readMemberAssignmentOperation 办理；业务角色另经原角色入口授予。',
        '只读原分配及原操作结果；租户开通不自动分配成员，Core 重开不恢复已撤回分配。'),
      step('binding', '获权租户管理员', '完成所选 Core 绑定与业务设置',
        '当前成员分配、业务角色和 Core 容器范围均已核验。', CONTRACT + '#读取core范围与业务就绪',
        '沿 readBinding、bind 和 bindingOperation 使用原操作；由 Core 提供首次业务设置和真实就绪条件。',
        '绑定结果未知时查原操作与当前范围；不重新 Seed，不将绑定记录当成业务数据已经可用。'),
      step('business', '获权成员', '验证所选业务与权限拒绝',
        '原宿主、Core 数据、部署准入、授权、分配、绑定和业务条件全部成立。', host + '/README.md',
        '从实际页面完成一条持久读写链及必要权限拒绝，再回读原结果；诊断不代办这些操作。',
        '写入未知时保留原请求引用并核原收据；取消等待不表示业务已回滚。'),
    );
  }
  const aiSelected = publicAi || report.selection?.capabilities.some(item => item.id === 'ai-native');
  if (aiSelected) steps.push(step('ai-readiness', '部署者 / 当前获权管理者', '核选装 AI 的适用权限与就绪',
    '同一固定数据包、Client 和真实数据观察成立；管理、业务工具和模型调用分别核权。',
    publicAi ? API + '#选装公共-ai-管理' : host + '/README.md',
    publicAi ? '沿显式 grant:ai 选择 SaaS 角色和 view/manage，再以当前会话回读权限与设置；默认启动和初始化不授权。'
      : '按所属 Core＋AI 宿主核数据、已发布能力、当前权限及政策；普通业务不因未配置模型而失效。',
    '保留原授权与操作结果；纯读取 MCP 不要求平台模型配置或云预算，委托服务端模型才走原 Gateway 与模型账。'));
  const member = report.runtime.member;
  if (member?.state === 'observed') {
    for (const [id, field, ready] of [['core-admission', 'deploymentAdmission', 'accepting'],
      ['tenant-grant', 'tenantGrant', 'enabled'], ['member-assignment', 'memberAssignment', 'assigned'],
      ['binding', 'binding', 'bound'], ['business', 'businessReadiness', 'ready']]) {
      const item = steps.find(step => step.id === id);
      if (!item) continue;
      item.state = member.cores.every(core => core[field] === ready) ? 'observed' : 'needs-observation-or-action';
      item.observation = member.cores.map(core => ({ id: core.id, state: core[field] }));
      if (id === 'business') item.actionVerified = false;
    }
  }
  return { scope: 'guidance-only', executes: false,
    localPrerequisitesChecked: localIssues.length === 0, databaseObserved: Boolean(report.database.checked),
    missingRuntimeEvidence: ['目标环境与执行权', '原迁移账与物理结构', '实际账号/会话', '实际部署与业务结果'],
    steps };
}

module.exports = { installationSteps };
