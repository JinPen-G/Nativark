'use strict';
/** Generate the fixed staff inspection wire registry from the authoritative
 * shared runtime exports. Compilation and module loading stay in memory;
 * only the explicitly requested registry is written, never shared dist/client. */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'apps/staff-miniprogram/src/components/ai-native/inspection-wire-schemas.ts');
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function buildInspectionWireRegistry() {
  const sharedRoot = path.join(root, 'packages/shared');
  // Logical module filenames only: no temporary directory or dependency copy.
  const destination = path.join(root, 'output/.tmp/inspection-wire-schemas');
  const key = value => ts.sys.useCaseSensitiveFileNames ? path.resolve(value) : path.resolve(value).toLowerCase();
  const emitted = new Map(), modules = new Map();
  try {
    const config = ts.readConfigFile(path.join(sharedRoot, 'tsconfig.json'), ts.sys.readFile);
    if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sharedRoot, {
      outDir: destination, composite: false, incremental: false, declaration: false,
      emitDeclarationOnly: false, noEmit: false, noEmitOnError: true, sourceMap: false, declarationMap: false
    });
    const program = ts.createProgram([path.join(sharedRoot, 'src/index.ts')], parsed.options);
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n'
    }));
    const emission = program.emit(undefined, (name, data) => {
      if (!inside(destination, path.resolve(name))) throw Error('Unexpected shared emission path');
      emitted.set(key(name), data);
    });
    if (emission.emitSkipped || emission.diagnostics.length) throw Error('Private shared emission failed');
    const sharedRequire = Module.createRequire(path.join(sharedRoot, 'package.json'));
    const load = name => {
      const filename = [name, name + '.js', name + '.json', path.join(name, 'index.js')]
        .find(candidate => emitted.has(key(candidate)));
      if (!filename) throw Error('Private shared runtime entry missing');
      if (modules.has(key(filename))) return modules.get(key(filename)).exports;
      const source = emitted.get(key(filename));
      const current = new Module(filename);
      current.filename = filename;
      modules.set(key(filename), current);
      current.require = request => {
        if (request.startsWith('.')) return load(path.resolve(path.dirname(filename), request));
        if (request !== 'zod' && !request.startsWith('zod/')) throw Error('Unexpected shared runtime dependency');
        return sharedRequire(request);
      };
      if (filename.endsWith('.json')) current.exports = JSON.parse(source);
      else current._compile(source, filename);
      return current.exports;
    };
    const shared = load(path.join(destination, 'index.js'));
    const contracts = { ...shared.AI_INSPECTION_MANUAL_HTTP_CONTRACTS, ...shared.AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS };
    const taskContracts = shared.AI_INSPECTION_TASK_HTTP_CONTRACTS;
    if (!taskContracts || !Object.keys(taskContracts).length) throw Error('Inspection task contracts missing');
    const taskHttp = shared.AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT;
    if (!taskHttp || Object.keys(taskContracts).some(name => typeof taskHttp[name] !== 'string' || !taskHttp[name]))
      throw Error('Inspection task route missing');
    const all = { ...shared.AI_INSPECTION_DRAFT_SCHEMAS, ...shared.AI_INSPECTION_MANUAL_HTTP_SCHEMAS,
      ...shared.AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS, ...shared.AI_TASK_RECOVERY_HTTP_SCHEMAS,
      ...shared.AI_TASK_INPUT_DRAFT_SCHEMAS, ...shared.AI_TASK_OBSERVATION_DRAFT_SCHEMAS, ...shared.AI_SCOPE_DRAFT_SCHEMAS };
    const schemas = {};
    function add(name) {
      if (Object.hasOwn(schemas, name)) return;
      if (!Object.hasOwn(all, name)) throw Error('Missing inspection schema: ' + name);
      schemas[name] = all[name];
      function refs(value) {
        if (!value || typeof value !== 'object') return;
        if (value.$ref) {
          const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(value.$ref);
          if (!match) throw Error('Unsupported inspection schema reference');
          add(match[1]);
        }
        Object.values(value).forEach(refs);
      }
      refs(all[name]);
    }
    for (const row of [...Object.values(contracts), ...Object.values(taskContracts)]) { add(row.request); add(row.response); }
    // A concurrent edit must not publish a registry from mixed source versions.
    for (const source of program.getSourceFiles()) {
      if (inside(path.join(sharedRoot, 'src'), path.resolve(source.fileName)) && ts.sys.readFile(source.fileName) !== source.text)
        throw Error('Shared source changed during inspection registry generation');
    }
    const content = '/** Generated by scripts/generate-inspection-wire-schemas.cjs from @rental-os/shared.\n * Do not edit: this local runtime data keeps the native package dependency-free. */\n'
      + 'import type { AiLeafSchemaDraft } from "@rental-os/shared";\n'
      + 'export const contracts = ' + JSON.stringify(contracts, null, 2) + ' as const;\n'
      + 'export const taskContracts = ' + JSON.stringify(taskContracts, null, 2) + ' as const;\n'
      + 'export const taskHttp = ' + JSON.stringify(taskHttp, null, 2) + ' as const;\n'
      + 'export const schemas: Record<string, AiLeafSchemaDraft> = ' + JSON.stringify(schemas, null, 2) + ';\n';
    return { content, contracts: Object.keys(contracts).length, taskContracts: Object.keys(taskContracts).length,
      schemas: Object.keys(schemas).length, privateEmit: 'memory' };
  } finally {
    modules.clear(); emitted.clear();
  }
}

if (require.main === module) {
  const outputIndex = process.argv.indexOf('--output'), check = process.argv.includes('--check');
  if (outputIndex >= 0 && (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith('--')))
    throw Error('Generated output path is required');
  const outputFile = outputIndex < 0 ? file : path.resolve(process.argv[outputIndex + 1]);
  if (outputIndex >= 0 && !inside(path.join(root, 'output'), outputFile)) throw Error('Generated output must stay in this tree output');
  const generated = buildInspectionWireRegistry();
  if (process.argv.includes('--stdout')) process.stdout.write(generated.content);
  else {
    if (check) {
      if (fs.readFileSync(outputFile, 'utf8').replaceAll('\r\n', '\n') !== generated.content)
        throw Error('Inspection registry differs from formal shared schemas');
    } else {
      if (fs.existsSync(outputFile)) throw Error('Registry already exists; inspect and approve its update first');
      fs.writeFileSync(outputFile, generated.content, { flag: 'wx' });
    }
    const { content, ...details } = generated;
    console.log(JSON.stringify({ mode: check ? 'check' : 'generate', ...details, file: outputFile }));
  }
}
module.exports = { buildInspectionWireRegistry };
