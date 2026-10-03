'use strict';
const blocked = () => { throw new Error('AI Native offline guard: external network is disabled'); };
for (const moduleName of ['http', 'https']) { const module = require(moduleName); module.request = blocked; module.get = blocked; }
try { const net = require('node:net'); net.connect = blocked; net.createConnection = blocked; const tls = require('node:tls'); tls.connect = blocked; } catch {}
global.fetch = blocked;
