'use strict';
// Test-process resolver only. Do not mutate shared node_modules or weaken the
// existing knowledge fixture's worktree-realpath assertions.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = fs.realpathSync(path.resolve(__dirname, '../../..'));
const shared = path.join(root,'packages/shared/src/index.ts');
const client = path.join(root,'apps/api/node_modules/@prisma/client/index.js');
if (!fs.existsSync(shared) || !fs.existsSync(client)) throw Error('Worktree-owned shared/Prisma required');
const marker = JSON.parse(fs.readFileSync(path.join(path.dirname(client),'.rental-ai-client-owner.json'),'utf8'));
if (fs.realpathSync(marker.worktree) !== root) throw Error('Wrong Prisma client owner');
const options = JSON.parse(process.env.TS_NODE_COMPILER_OPTIONS || '{}');
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({...options,baseUrl:root,paths:{...options.paths,
  '@rental-os/shared':['packages/shared/src/index.ts'], '@prisma/client':['apps/api/node_modules/@prisma/client/index.d.ts']}});
const original=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args) {
  const from=parent?.filename;
  if (from && (from===root || from.startsWith(root+path.sep))) {
    if (request==='@rental-os/shared') return shared;
    if (request==='@prisma/client') return client;
  }
  return original.call(this,request,parent,...args);
};
