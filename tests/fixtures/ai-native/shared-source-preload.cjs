'use strict';
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'packages/shared/src/index.ts');
const resolve = Module._resolveFilename;
// Validate fixed shared sources without replacing the worktree's generated package artifacts.
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ ...JSON.parse(process.env.TS_NODE_COMPILER_OPTIONS || '{}'),
  baseUrl: root, paths: { '@rental-os/shared': [source] } });
Module._resolveFilename = function(request, parent, ...options) {
  return resolve.call(this, request === '@rental-os/shared' ? source : request, parent, ...options);
};
