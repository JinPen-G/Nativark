'use strict';
/** 核验适配器：真实构建器在 memfs 中执行原文件操作，源码和依赖只读。
 * 仅用于无落盘验证；不把内存安装描述为操作系统安装或部署。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isBuiltin } = require('node:module');
const root = path.resolve(__dirname, '..');
const slash = file => {
  const prefix = '\\\\?\\', uncPrefix = prefix + 'UNC\\';
  if (file.startsWith(uncPrefix)) file = '\\\\' + file.slice(uncPrefix.length);
  else if (file.startsWith(prefix)) file = file.slice(prefix.length);
  return path.resolve(file).split(path.sep).join('/');
};
const inside = (directory, file) => file === directory || file.startsWith(directory + '/');

function createMemoryBuild(build) {
  const { Volume, createFsFromVolume } = build.requireDeps('memfs');
  const volume = new Volume(), memory = createFsFromVolume(volume);
  // memfs 3.5 uses mutable ctime as birthtime. Keep creation identity per Node,
  // including a new identity when an inode is reused after deletion.
  const births = new WeakMap();
  let nextBirth = 0;
  const assignBirth = node => {
    nextBirth = Math.max(Date.now(), nextBirth + 1);
    births.set(node, nextBirth);
    return node;
  };
  for (const node of Object.values(volume.inodes)) assignBirth(node);
  const createNode = volume.createNode;
  volume.createNode = function (...args) {
    return assignBirth(createNode.apply(this, args));
  };
  const stableStats = (stats, node) => {
    const birth = births.get(node);
    if (birth === undefined) throw Error('内存文件创建身份未核定');
    stats.birthtime = new Date(birth);
    stats.birthtimeMs = typeof stats.birthtimeMs === 'bigint' ? BigInt(birth) : birth;
    return stats;
  };
  for (const name of ['statSync', 'lstatSync']) {
    const original = memory[name];
    memory[name] = (...args) => {
      const stats = original(...args);
      if (stats === undefined) return stats;
      return stableStats(stats, volume.inodes[Number(stats.ino)]);
    };
  }
  const fstat = memory.fstatSync;
  memory.fstatSync = (descriptor, ...args) => {
    const stats = fstat(descriptor, ...args);
    return stableStats(stats, volume.getFileByFd(descriptor).node);
  };
  const key = file => '/' + slash(file);
  const task = path.join(root, 'output/.tmp/rental-package-build-dev2');
  const workspaceRoot = slash(root), writable = slash(task);
  const mapped = file => {
    const current = slash(file), modules = workspaceRoot + '/node_modules';
    return inside(modules, current) ? build.deps + current.slice(modules.length) : current;
  };
  const generated = file => inside(workspaceRoot, slash(file))
    && /\/(?:dist(?:-[^/]+)?|generated)\//u.test(slash(file));
  const exists = file => memory.existsSync(key(file));
  const permitted = file => {
    if (!inside(writable, slash(file))) throw Error('内存写入越出任务目录：' + file);
  };
  function put(file, text) {
    memory.mkdirSync(path.posix.dirname(key(file)), { recursive: true });
    memory.writeFileSync(key(file), text);
  }
  for (const [file, text] of build.outputs) put(file, text);
  for (const [file, text] of build.virtual) put(file, text);
  if (build.snapshot) for (const [file, bytes] of build.snapshot.files) put(file, bytes);
  memory.mkdirSync(key(task), { recursive: true });
  const api = { ...fs };
  const readable = file => exists(file) || !generated(file)
    && !(build.snapshot && inside(workspaceRoot, slash(file)) && !inside(workspaceRoot + '/node_modules', slash(file)));
  for (const name of ['readFileSync', 'statSync', 'lstatSync', 'accessSync']) api[name] = (file, ...args) => {
    if (name === 'readFileSync' && typeof file === 'number') return memory.readFileSync(file, ...args);
    if (exists(file)) return memory[name](key(file), ...args);
    if (!readable(file)) return memory[name](key(file), ...args);
    return fs[name](mapped(file), ...args);
  };
  api.existsSync = file => exists(file) || readable(file) && fs.existsSync(mapped(file));
  api.realpathSync = file => {
    if (exists(file)) return path.resolve(file);
    return fs.realpathSync(mapped(file));
  };
  api.realpathSync.native = api.realpathSync;
  api.readdirSync = (file, options) => {
    const found = new Map();
    if (!(build.snapshot && inside(workspaceRoot, slash(file)) && !inside(workspaceRoot + '/node_modules', slash(file)))
      && readable(file) && fs.existsSync(mapped(file))) {
      for (const entry of fs.readdirSync(mapped(file), options)) found.set(typeof entry === 'string' ? entry : entry.name, entry);
    }
    if (exists(file)) for (const entry of memory.readdirSync(key(file), options))
      found.set(typeof entry === 'string' ? entry : entry.name, entry);
    return [...found.values()];
  };
  for (const name of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'unlinkSync', 'rmdirSync', 'rmSync']) api[name] = (file, ...args) => {
    if (name === 'writeFileSync' && typeof file === 'number') return memory.writeFileSync(file, ...args);
    permitted(file);
    return memory[name](key(file), ...args);
  };
  api.mkdtempSync = prefix => {
    permitted(prefix);
    return path.resolve(memory.mkdtempSync(key(prefix)).slice(1));
  };
  api.copyFileSync = (source, destination) => {
    permitted(destination);
    return memory.writeFileSync(key(destination), api.readFileSync(source));
  };
  api.renameSync = (source, destination) => {
    permitted(source); permitted(destination);
    return memory.renameSync(key(source), key(destination));
  };
  // No asynchronous file operation or native process is needed by these build
  // and install functions. Refuse any unexpected extension of that boundary.
  api.openSync = (file, flags, mode) => {
    permitted(file);
    return memory.openSync(key(file), flags, mode);
  };
  for (const name of ['writeSync', 'closeSync', 'fstatSync', 'readSync']) api[name] = memory[name].bind(memory);
  for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'createWriteStream', 'open'])
    api[name] = () => { throw Error('未核定的内存文件操作：' + name); };
  api.promises = new Proxy({}, { get: (_, name) => () => { throw Error('未核定的异步文件操作：' + String(name)); } });
  const modules = new Map();
  const resolve = (name, from) => {
    if (build.runtimeAliases.has(name)) return build.runtimeAliases.get(name);
    if (name.startsWith('@rental-os/')) return build.exported(name, true);
    if (name.startsWith('.') || path.isAbsolute(name)) {
      const target = path.resolve(path.dirname(from), name);
      const file = [target, target + '.js', target + '.cjs', target + '/index.js'].find(file => api.existsSync(file) && api.statSync(file).isFile());
      if (!file) throw Error('内存构建模块缺失：' + name);
      return file;
    }
    return build.requireDeps.resolve(name);
  };
  const processView = Object.create(process);
  processView.env = { ...process.env, DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
    AI_OFFLINE_WRITE_ROOT: task, AI_OFFLINE_AUDIT: path.join(task, 'guard.log'), TEMP: task, TMP: task };
  processView.once = () => processView;
  function load(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file).exports;
    if (file.endsWith('.json')) return JSON.parse(api.readFileSync(file, 'utf8'));
    const module = { exports: {} }; modules.set(file, module);
    const requireMemory = name => {
      if (name === '@prisma/client' || /(?:^|\/)\.prisma\/client(?:\/|$)/u.test(name))
        throw Error('正式发行运行时禁止默认生成 Client：' + name);
      if (['fs', 'node:fs'].includes(name)) return api;
      if (['child_process', 'node:child_process'].includes(name)) return new Proxy({}, {
        get: () => () => { throw Error('内存构建拒绝启动进程'); }
      });
      if (isBuiltin(name)) return require(name);
      if (build.runtimeAliases.has(name) || name === 'typescript' || name.startsWith('typescript/') || name.startsWith('@rental-os/')
        || name.startsWith('.') || path.isAbsolute(name)) return load(resolve(name, file));
      return build.requireDeps(name);
    };
    requireMemory.resolve = name => resolve(name, file);
    const text = api.readFileSync(file, 'utf8').replace(/^#!.*\r?\n/, '');
    new vm.Script(`(function(require,module,exports,__dirname,__filename,process){${text}\n})`, { filename: file })
      .runInThisContext()(requireMemory, module, module.exports, path.dirname(file), file, processView);
    return module.exports;
  }
  const files = directory => {
    const result = new Map();
    const visit = current => {
      for (const entry of memory.readdirSync(key(current), { withFileTypes: true })) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) visit(file);
        else result.set(path.relative(directory, file).split(path.sep).join('/'), memory.readFileSync(key(file)));
      }
    };
    visit(directory); return result;
  };
  return { fs: api, task, load, files, put };
}
module.exports = { createMemoryBuild };
