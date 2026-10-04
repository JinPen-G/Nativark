'use strict';
const fs = require('node:fs');
const path = require('node:path');
const allowed = new Set(['code', 'synthetic', 'actor', 'scope', 'inputRefs', 'expected']);
const actorKinds = new Set(['operator', 'staff', 'client', 'saas_admin', 'automation']);
const scopeKinds = new Set(['workspace', 'tenant', 'platform']);
const branches = new Set(['success', 'missing_evidence', 'forbidden', 'conflict', 'no_inventory', 'cross_scope', 'published', 'withdrawn', 'acl_narrowed', 'expired', 'proposed', 'confirmed', 'revoked', 'automation_impersonation']);
function assertRecord(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function validateScenario(value, source = 'inline') {
  const scenario = assertRecord(value, source);
  for (const key of Object.keys(scenario)) if (!allowed.has(key)) throw new Error(`${source}: unknown field ${key}`);
  if (scenario.synthetic !== true) throw new Error(`${source}: synthetic marker is required`);
  if (typeof scenario.code !== 'string' || !/^[a-z][a-z0-9_.-]{2,63}$/.test(scenario.code)) throw new Error(`${source}: invalid scenario code`);
  const actor = assertRecord(scenario.actor, `${source}.actor`); const scope = assertRecord(scenario.scope, `${source}.scope`);
  if (!actorKinds.has(actor.kind) || typeof actor.id !== 'string' || !/^synthetic_/.test(actor.id)) throw new Error(`${source}: invalid synthetic actor`);
  if (!scopeKinds.has(scope.kind) || typeof scope.id !== 'string' || !/^synthetic_/.test(scope.id)) throw new Error(`${source}: invalid synthetic scope`);
  if (!Array.isArray(scenario.inputRefs) || scenario.inputRefs.length > 32 || scenario.inputRefs.some(ref => typeof ref !== 'string' || !/^synthetic_/.test(ref))) throw new Error(`${source}: invalid inputRefs`);
  if (!branches.has(scenario.expected)) throw new Error(`${source}: unknown expected branch`);
  const size = Buffer.byteLength(JSON.stringify(scenario), 'utf8'); if (size > 128 * 1024) throw new Error(`${source}: fixture exceeds 128 KiB`);
  return Object.freeze(JSON.parse(JSON.stringify(scenario)));
}
function loadScenarioFile(file) { const filename = path.resolve(file); return validateScenario(JSON.parse(fs.readFileSync(filename, 'utf8')), filename); }
module.exports = { validateScenario, loadScenarioFile };
