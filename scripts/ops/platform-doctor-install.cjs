#!/usr/bin/env node
'use strict';
/** 显式安装办理：status 只读；migrate 需核过本次组合/目标摘要；initialize 复用原服务。
 * 不下载、不生成 Client、不启服务、不授权 Core；失应答只提供原账/账号回读入口。 */
const { parseArguments } = require('./platform-doctor.cjs');
const { openInstallation, readInstallation, migrate } = require('./platform-doctor-runtime.cjs');
const { HASH } = require('./platform-doctor-files.cjs');
const HELP = `Zelo 安装与原阶段恢复
node scripts/ops/platform-doctor-install.cjs status --profile platform|public-ai [--lock <绝对JSON>] [--capability ai-native=<绝对包目录>]
node scripts/ops/platform-doctor-install.cjs migrate --profile platform|public-ai --approve <status给出的migrationApproval>
node scripts/ops/platform-doctor-install.cjs initialize --profile platform|public-ai
其他材料参数与 platform-doctor 相同。profile 必须显式选择。仅在本工具源码根办理。
status 明确连接进程指定的数据库，只读原账/结构/账号；不读取 .env。
migrate 只接受已核空库或公共迁移前缀，使用原 Prisma migrate deploy；未知/未结束迁移停止。
initialize 在真实数据就绪后调用原平台初始化，首次口令来自 SEED_PLATFORM_PASSWORD，重复不重置账号。
中断后先 status；unknown/failed 交原数据所有者恢复，不自动重发、不执行 migrate resolve。
退出 0：本次读取/执行完成；1：已知缺项或拒绝；2：未检查/用法错误/结果未知。登录和业务须单独验收。`;

async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
  const [command, ...rest] = args;
  let options, approval;
  try {
    const index = rest.indexOf('--approve');
    if (index >= 0) { approval = rest[index + 1]; rest.splice(index, 2); if (!HASH.test(approval ?? '')) throw Error('usage'); }
    if (!['status', 'migrate', 'initialize'].includes(command) || !rest.includes('--profile')
      || command !== 'migrate' && approval || command === 'migrate' && !approval) throw Error('usage');
    options = parseArguments(rest);
    if (options.help || options.database || options.service || options.steps || options.profile === 'selected-core') throw Error('usage');
  } catch { console.error('安装参数无效；运行 --help 核对显式组合及操作。'); return 2; }
  if (command === 'status') {
    const observation = await readInstallation(options, environment);
    console.log(JSON.stringify(observation, null, 2));
    return observation.state === 'unknown' ? 2 : ['incompatible', 'migration_incomplete'].includes(observation.state)
      || observation.initialization.state === 'conflict' ? 1 : 0;
  }
  let context, dispatched = false;
  try {
    context = await openInstallation(options, environment);
    const before = await context.read();
    if (command === 'migrate') {
      if (approval !== context.approval || !['empty', 'migration_pending', 'ready'].includes(before.state)) {
        console.log(JSON.stringify({ status: 'refused', reason: 'migration_approval_or_baseline', observation: before })); return 1;
      }
      if (before.state === 'ready') { console.log(JSON.stringify({ status: 'already_applied', observation: before })); return 0; }
      // Prisma owns the migration lock. Stop the observing connection before handing execution to its original CLI.
      await context.close();
      dispatched = true;
      const code = await migrate(context, environment);
      const after = await context.read();
      const complete = code === 0 && after.state === 'ready';
      console.log(JSON.stringify({ status: complete ? 'applied' : 'unknown', commandExitCode: code, observation: after,
        recovery: '先重读 status 的原迁移账和物理状态；未结束收据须按原迁移恢复，不能自动重放。' }, null, 2));
      return complete ? 0 : 2;
    }
    if (before.state !== 'ready' || !['uninitialized', 'initialized'].includes(before.initialization.state)
      || !environment.SEED_PLATFORM_PASSWORD || environment.SEED_PLATFORM_PASSWORD.length < 8
      || !/[a-z]/iu.test(environment.SEED_PLATFORM_PASSWORD) || !/\d/u.test(environment.SEED_PLATFORM_PASSWORD)) {
      console.log(JSON.stringify({ status: 'refused', reason: 'initialization_prerequisites', observation: before })); return 1;
    }
    dispatched = true;
    const result = await context.api.initializeInstallation(context.database, context.selection, environment.SEED_PLATFORM_PASSWORD);
    const complete = result.observation.state === 'ready' && result.observation.initialization.state === 'initialized';
    console.log(JSON.stringify({ status: complete ? 'completed' : 'unknown', ...result }, null, 2));
    return complete ? 0 : 2;
  } catch {
    console.log(JSON.stringify({ status: dispatched ? 'unknown' : 'refused', reason: 'installation_not_completed',
      recovery: '核对同树依赖、构建、所选 Client、固定锁和进程配置；先 status 回读原账、账号和初始化审计，不自动重试。' }));
    return dispatched ? 2 : 1;
  } finally { if (context) await context.close().catch(() => {}); }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main };
