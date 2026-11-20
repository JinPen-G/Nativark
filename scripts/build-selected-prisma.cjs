'use strict';
/** 正式包编译入口。只消费宿主已生成的 Client 声明，不生成、加载或实例化 Client。
 * 保留包原 tsconfig/rootDir/exports；唯一新增解析项是 @prisma/client 的精确类型路径。
 * --client <index.d.ts> 或绝对 RENTAL_PRISMA_CLIENT 由调用者显式选择，同一 npm 前置链共用。
 */
const path = require('node:path');
const { createRequire } = require('node:module');
const modes = ['platform', 'rental', 'rental-ai'];
const slash = value => path.resolve(value).split(path.sep).join('/');
const samePath = (a, b) => process.platform === 'win32' ? slash(a).toLowerCase() === slash(b).toLowerCase() : slash(a) === slash(b);

function parseArguments(args, environment = process.env, cwd = process.cwd()) {
  const values = {}, flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--noEmit' || key === '--help' || key === '--legacy') {
      if (flags.has(key)) throw Error('重复选项：' + key);
      flags.add(key);
    } else if (['--project', '--client', '--mode'].includes(key)) {
      if (Object.hasOwn(values, key) || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('选项缺值或重复：' + key);
      values[key] = args[++index];
    } else throw Error('未知编译选项：' + key);
  }
  if (flags.has('--help')) return { help: true };
  if (!values['--project'] || !modes.includes(values['--mode'])) throw Error('必须指定 --project 和 --mode platform|rental|rental-ai');
  const inherited = environment.RENTAL_PRISMA_CLIENT;
  if (inherited && !path.isAbsolute(inherited)) throw Error('RENTAL_PRISMA_CLIENT 必须是绝对路径，避免 npm 子目录切换改变选择');
  const client = values['--client'] ? path.resolve(cwd, values['--client']) : inherited;
  if (!client) throw Error('缺少所选 Client；提供 --client 或绝对 RENTAL_PRISMA_CLIENT，先由宿主生成专属 Client');
  if (inherited && !samePath(client, inherited)) throw Error('--client 与 RENTAL_PRISMA_CLIENT 冲突，不能在同一构建链切换 Client');
  if (environment.RENTAL_PRISMA_LEGACY && environment.RENTAL_PRISMA_LEGACY !== '1') throw Error('RENTAL_PRISMA_LEGACY 只接受显式值 1');
  return { project: path.resolve(cwd, values['--project']), client: path.resolve(client), mode: values['--mode'],
    noEmit: flags.has('--noEmit'), legacy: flags.has('--legacy') || environment.RENTAL_PRISMA_LEGACY === '1' };
}

function readRequired(readFile, file, label) {
  const text = readFile(file);
  if (typeof text !== 'string' || !text.trim()) throw Error(label + ' 缺失或为空：' + file);
  return text;
}

/** 与离线验证共用同一选型检查。readFile 仅供测试替换运输；CLI 固定使用 ts.sys。
 * 元数据取自已生成目录，不调用 Prisma generator，也不把模式名当作模型声明。 */
function selectedCompilerOptions(ts, project, options, selection, readFile = ts.sys.readFile) {
  if (!modes.includes(selection?.mode) || !selection.client || !path.isAbsolute(selection.client)) throw Error('所选 Client 必须有明确模式与绝对声明路径');
  const client = slash(selection.client);
  const defaultClient = /(?:^|\/)node_modules(?:\/|$)|(?:^|\/)\.prisma(?:\/|$)/u.test(client);
  const projectRoot = path.dirname(project);
  if (path.basename(client) !== 'index.d.ts' || defaultClient && !selection.legacy)
    throw Error('必须指向宿主专属 generated Client 的 index.d.ts，不能使用默认 node_modules/.prisma Client');
  if (selection.legacy && (!defaultClient || selection.mode === 'platform' || /\/apps\/(?:rental|platform)-api(?:\/|$)/u.test(slash(project))))
    throw Error('legacy 仅供旧组合宿主及其依赖包显式消费原默认 Client，独立宿主禁止使用');
  const directory = path.dirname(client), text = readRequired(readFile, client, '宿主 Client 声明');
  const schema = readRequired(readFile, path.join(directory, 'schema.prisma'), '同一生成 Client 的 schema');
  const tree = ts.createSourceFile(client, text, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) throw Error('所选 Client 声明语法无效');
  const prisma = tree.statements.find(node => ts.isModuleDeclaration(node) && node.name.text === 'Prisma');
  const declarations = prisma?.body && ts.isModuleBlock(prisma.body) ? prisma.body.statements : [];
  const modelDeclaration = declarations.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find(node => ts.isIdentifier(node.name) && node.name.text === 'ModelName');
  const classDeclaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PrismaClient');
  if (!classDeclaration || !modelDeclaration?.type || !ts.isTypeLiteralNode(modelDeclaration.type))
    throw Error('所选文件不是已生成的完整 Prisma Client 声明，默认模板或转出口不能代替');
  const models = modelDeclaration.type.members.map(node => {
    if (!ts.isPropertySignature(node) || !node.name || !ts.isIdentifier(node.name) && !ts.isStringLiteral(node.name)
      || !node.type || !ts.isLiteralTypeNode(node.type) || !ts.isStringLiteral(node.type.literal)
      || node.name.text !== node.type.literal.text) throw Error('Prisma ModelName 声明无效');
    return node.name.text;
  }).sort();
  const schemaModels = [...schema.matchAll(/^\s*model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map(match => match[1]).sort();
  if (!schemaModels.length || new Set(schemaModels).size !== schemaModels.length || JSON.stringify(models) !== JSON.stringify(schemaModels))
    throw Error('Client 声明与同目录 schema 的模型集合不一致；请由宿主重新核定生成物');
  const required = selection.mode === 'platform' ? ['Tenant', 'User', 'AuthSession']
    : ['Tenant', 'User', 'AuthSession', 'BusinessWorkspace', 'WorkspaceMember', 'RentalOrder', 'RentalQuote'];
  if (selection.mode === 'rental-ai') required.push('AiTask', 'AiTaskOriginalRequest', 'AiGatewayInvocation');
  if (required.some(model => !models.includes(model)) || selection.mode === 'platform' && models.some(model => /^(?:Rental|Ai|BusinessWorkspace$|WorkspaceMember$)/u.test(model)))
    throw Error('所选 Client 不满足 ' + selection.mode + ' 模式的原模型要求');
  const generators = [...schema.matchAll(/^generator\s+\w+\s*\{([\s\S]*?)^\}/gm)];
  if (generators.length !== 1 || !/provider\s*=\s*"prisma-client-js"/u.test(generators[0][1])
    || !selection.legacy && !/output\s*=\s*"[^"]+"/u.test(generators[0][1])) throw Error('Client schema 必须声明原 prisma-client-js 及宿主专属 output');
  if (selection.legacy) {
    const workspace = path.resolve(__dirname, '..');
    const permitted = ['node_modules/.prisma/client/index.d.ts', 'apps/api/node_modules/.prisma/client/index.d.ts']
      .map(relative => path.join(workspace, relative));
    if (!permitted.some(file => samePath(file, client))) throw Error('legacy Client 不属于本仓库原 apps/api 的生成目录');
    const original = readRequired(readFile, path.join(workspace, 'apps/api/prisma/schema.prisma'), '旧宿主正式 schema');
    if (schema.replace(/\r\n/gu, '\n').trim() !== original.replace(/\r\n/gu, '\n').trim())
      throw Error('legacy Client schema 与本仓库原 apps/api 源码不一致');
  }
  const configured = options.paths?.['@prisma/client'];
  const pathsBase = options.baseUrl || options.pathsBasePath || projectRoot;
  if (configured && (configured.length !== 1 || !samePath(path.resolve(pathsBase, configured[0]), client)))
    throw Error('原 tsconfig 已选择另一个 Client；显式选择必须与宿主配置一致');
  return { options: { ...options, noEmitOnError: true,
    paths: { ...options.paths, '@prisma/client': [client] } }, client, mode: selection.mode, models: models.length };
}

function compileProject(input) {
  // Resolve the installed compiler from this project's dependencies. No alternate
  // workspace, generated default Client, runtime import hook or source alias.
  const requireProject = createRequire(path.join(path.dirname(input.project), 'package.json'));
  const ts = requireProject('typescript');
  const parsed = ts.getParsedCommandLineOfConfigFile(input.project, {}, { ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => { throw Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); } });
  if (!parsed) throw Error('无法读取原项目 tsconfig');
  const selected = selectedCompilerOptions(ts, input.project, parsed.options, input);
  const options = input.noEmit ? { ...selected.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined } : selected.options;
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, projectReferences: parsed.projectReferences, host });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const emitted = diagnostics.length || options.noEmit ? undefined : program.emit();
  if (emitted) diagnostics.push(...emitted.diagnostics);
  if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => ts.sys.newLine,
  }));
  const failed = diagnostics.length > 0 || Boolean(emitted?.emitSkipped);
  console.log(JSON.stringify({ project: slash(input.project), client: selected.client, mode: selected.mode,
    models: selected.models, diagnostics: diagnostics.length, noEmit: Boolean(options.noEmit), status: failed ? 'failed' : 'passed' }));
  return failed ? 1 : 0;
}

if (require.main === module) {
  try {
    const input = parseArguments(process.argv.slice(2));
    if (input.help) console.log('node scripts/build-selected-prisma.cjs --project <tsconfig.json> --mode platform|rental|rental-ai [--client <index.d.ts>] [--noEmit] [--legacy]\n也可预设绝对 RENTAL_PRISMA_CLIENT，供 npm 前置链继承。旧默认 Client 另须 --legacy 或 RENTAL_PRISMA_LEGACY=1；独立宿主禁止 legacy。只编译；不生成 Client、读取 .env 或连接数据库。');
    else process.exitCode = compileProject(input);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseArguments, selectedCompilerOptions, compileProject };
