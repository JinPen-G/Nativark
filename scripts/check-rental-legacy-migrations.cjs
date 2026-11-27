'use strict';
/** Read-only receipt and MySQL catalog check for the two pinned mixed Rental releases.
 * It prints a snapshot query or checks its stdin; it does not connect, migrate or adopt a v2 lock. */
const { createHash } = require('node:crypto');

const FORMAT = 'rental-mixed-mysql-observation-1';
// The catalog pins are from the fixed SQL replay on Linux MySQL 8.4.11,
// with the documented Outbox repair and boolean follow-up executed separately.
const BASE = {
  commit: 'b6f25ce9b694c54bc596379f351ff02c8972260c',
  migrations: 260,
  ledger: '2d4fa3ee0d0c4c690654b7f6ed9fd7395ebe045e3ca679e4fdd5e5e8246b7879',
  physical: '17af1d770d3d41152c1818d6fccfbda5601a6d456ce787ab3c9855a9743ca3f2',
};
const TARGET = {
  commit: '39fbfb5c55706de8b1df1c2239d4adfc2ae95667',
  migrations: 263,
  ledger: 'cd33932fe3bc63088a980aebd1749ea002d02248803feb92797503827936c93f',
  physical: '5d0bd534036cccf2bc19f0cb977c28301b4beb3bc6cf816c82cbbc1d6b718369',
};
const PENDING = [
  { name: '20261114190000_tenant_operator_short_name', checksum: '20f8360e41028388a0cf26ca9c7337c4ef97a56a426303550da781bb2d0d97b3' },
  { name: '20261115110000_tenant_operator_email_invitations', checksum: 'aea2f00271968dc9bb74125111c43ac658c2bad31a6ac6bbcdbf4a70c2a476c9' },
  { name: '20261115111000_tenant_support_email_inbox', checksum: '96e9da2eaca4b9adebb3bd32f0a413cc3c14a333f1804e4cdf45940a559f0b0e' },
];
const REPAIRED = '20261111220000_ai_failure_resource_sources';
const REPAIRED_SQL = '3c9497cb22648d0c9c336208ab5ea4b209dd2b3f4d2253fe8fadddf83e5b9142';
const EMPTY_LOG_SHA256 = createHash('sha256').update('').digest('hex');
const LIMIT = 16 * 1024 * 1024;
const sha = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');

// Require a consistent read of receipts and a catalog collected without concurrent DDL.
// Compare physical identifiers bytewise. Omit statistics that change with row data.
const sql = `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;
SELECT JSON_ARRAY('${FORMAT}', VERSION(), @@lower_case_table_names,
  @@collation_database, @@transaction_isolation, @@foreign_key_checks);
SELECT JSON_ARRAY('receipt', id, migration_name, checksum,
  DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%s.%f'),
  DATE_FORMAT(finished_at, '%Y-%m-%dT%H:%i:%s.%f'),
  DATE_FORMAT(rolled_back_at, '%Y-%m-%dT%H:%i:%s.%f'), applied_steps_count, SHA2(logs, 256))
  FROM \`_prisma_migrations\`;
SELECT JSON_ARRAY('legacy-b02', COUNT(*)) FROM ai_legacy_b02_scopes;
SELECT JSON_ARRAY('table', TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, ROW_FORMAT, CREATE_OPTIONS)
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
SELECT JSON_ARRAY('column', TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE,
  IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME, EXTRA, GENERATION_EXPRESSION)
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE();
SELECT JSON_ARRAY('index', TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME,
  NON_UNIQUE, SUB_PART, COLLATION, INDEX_TYPE, IS_VISIBLE, EXPRESSION)
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE();
SELECT JSON_ARRAY('check', t.TABLE_NAME, t.CONSTRAINT_NAME, t.ENFORCED, c.CHECK_CLAUSE)
  FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
  ON BINARY c.CONSTRAINT_SCHEMA = BINARY t.CONSTRAINT_SCHEMA
  AND BINARY c.CONSTRAINT_NAME = BINARY t.CONSTRAINT_NAME
  WHERE t.TABLE_SCHEMA = DATABASE() AND t.CONSTRAINT_TYPE = 'CHECK';
SELECT JSON_ARRAY('foreign-key', k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME,
  BINARY k.REFERENCED_TABLE_SCHEMA = BINARY DATABASE(), k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
  k.POSITION_IN_UNIQUE_CONSTRAINT, r.MATCH_OPTION, r.DELETE_RULE, r.UPDATE_RULE)
  FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON BINARY r.CONSTRAINT_SCHEMA = BINARY k.CONSTRAINT_SCHEMA
  AND BINARY r.TABLE_NAME = BINARY k.TABLE_NAME AND BINARY r.CONSTRAINT_NAME = BINARY k.CONSTRAINT_NAME
  WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL;
SELECT JSON_ARRAY('trigger', TRIGGER_NAME, EVENT_OBJECT_TABLE) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();
SELECT JSON_ARRAY('routine', ROUTINE_NAME, ROUTINE_TYPE) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE();
SELECT JSON_ARRAY('event', EVENT_NAME, STATUS) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE();
COMMIT;
SELECT JSON_ARRAY('complete');
`;

const physicalWidths = { table: 7, column: 10, index: 11, check: 5, 'foreign-key': 12, trigger: 3, routine: 3, event: 3 };
const hex = /^[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const migrationName = /^\d{14}_[a-zA-Z0-9_-]+$/u;
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/u;
const isTimestamp = value => typeof value === 'string' && timestamp.test(value)
  && Number.isFinite(Date.parse(value.slice(0, -3) + 'Z'));
const scope = { scope: 'legacy-mixed', approved: false, v2Adoption: 'requires-bridge', rollback: 'not-verified' };
const reject = (reason, facts) => ({ ...scope, status: 'refused', reason, ...facts });

function checkObservation(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT) throw Error('预检输入超过上限或不是文本');
  const lines = text.trimEnd().split(/\r?\n/u);
  if (lines.length > 20000) throw Error('预检输入行数超过上限');
  const [header, ...body] = lines.map(line => JSON.parse(line));
  const end = body.pop();
  if (!Array.isArray(header) || header[0] !== FORMAT || header.length !== 6
    || !Array.isArray(end) || end.length !== 1 || end[0] !== 'complete') return reject('observation_incomplete');
  if (typeof header[1] !== 'string' || !/^8\.4\.\d+(?:[-+][\w.+-]+)?$/u.test(header[1])
    || header[2] !== 0 || header[3] !== 'utf8mb4_unicode_ci' || header[4] !== 'REPEATABLE-READ' || header[5] !== 1)
    return reject('mysql_profile_changed');

  const receipts = new Map(), reverted = [], ids = new Set(), physical = [];
  let b02Checked = false;
  for (const row of body) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') return reject('unrecognized_observation');
    if (row[0] === 'legacy-b02') {
      if (b02Checked || row.length !== 2 || row[1] !== 0) return reject('unsupported_b02_provenance');
      b02Checked = true;
      continue;
    }
    if (row[0] !== 'receipt') {
      if (!Object.hasOwn(physicalWidths, row[0]) || row.length !== physicalWidths[row[0]]) return reject('unrecognized_observation');
      physical.push(JSON.stringify(row));
      continue;
    }
    const [, id, name, checksum, started, finished, rolledBack, steps, logHash] = row;
    if (row.length !== 9 || typeof id !== 'string' || !uuid.test(id) || ids.has(id)
      || typeof name !== 'string' || typeof checksum !== 'string' || !hex.test(checksum)
      || !isTimestamp(started) || ![0, 1].includes(steps) || !(logHash === null || typeof logHash === 'string' && hex.test(logHash))
      || !(finished === null || isTimestamp(finished) && finished >= started)
      || !(rolledBack === null || isTimestamp(rolledBack) && rolledBack >= started)
      || finished !== null && rolledBack !== null) return reject('invalid_receipt');
    ids.add(id);
    if (!migrationName.test(name)) return reject('unknown_migration_namespace');
    if (rolledBack !== null) {
      // Accept only the documented recovered attempt, paired below with its original success.
      if (reverted.length || name !== REPAIRED || checksum !== REPAIRED_SQL || steps !== 0 || logHash === null)
        return reject('unrecognized_rollback');
      reverted.push(rolledBack);
      continue;
    }
    if (finished === null) return reject('unfinished_migration');
    // Prisma resolve writes an empty log for this repaired migration. The
    // original rollback pairing and timestamp checks below remain mandatory.
    const resolvedEmptyLog = name === REPAIRED && checksum === REPAIRED_SQL
      && steps === 0 && logHash === EMPTY_LOG_SHA256;
    if (receipts.has(name) || logHash !== null && !resolvedEmptyLog || steps === 0 && (name !== REPAIRED || checksum !== REPAIRED_SQL))
      return reject('invalid_success_receipt');
    receipts.set(name, { checksum, started, steps });
  }
  if (!b02Checked) return reject('observation_incomplete');
  const recovered = receipts.get(REPAIRED);
  if ((reverted.length && (!recovered || recovered.checksum !== REPAIRED_SQL || recovered.started < reverted[0]))
    || (recovered?.steps === 0 && reverted.length !== 1)) return reject('unmatched_recovery');

  const pairs = [...receipts.keys()].sort().map(name => ({ name, checksum: receipts.get(name).checksum }));
  const ledger = sha(pairs);
  const match = [BASE, TARGET].find(candidate => candidate.migrations === pairs.length && candidate.ledger === ledger);
  if (!match) return reject('unknown_migration_history', { successful: pairs.length, ledgerSha256: ledger });
  const observedPhysical = sha(physical.sort());
  if (observedPhysical !== match.physical) return reject('physical_drift', { commit: match.commit, physicalSha256: observedPhysical });

  // Compare the set of original receipt identities, not a sorted 263-file prefix.
  // The pending 11/14 name sorts before a repair that the 260 source already applied.
  return { ...scope, status: match === BASE ? 'forward_plan' : 'mixed_current', commit: match.commit,
    successful: pairs.length, historicalRollbacks: reverted.length, ledgerSha256: ledger, physicalSha256: observedPhysical,
    ...(match === BASE ? { targetCommit: TARGET.commit, pendingMigrations: PENDING } : { pendingMigrations: [] }) };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--sql') return void process.stdout.write(sql);
  if (args.length !== 1 || args[0] !== '--check') throw Error('用法：check-rental-legacy-migrations.cjs --sql | --check（从标准输入读观测）');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > LIMIT) throw Error('预检输入超过上限');
    chunks.push(chunk);
  }
  const result = checkObservation(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'refused') process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // JSON parse errors can include raw input. Do not echo captured metadata or logs.
  console.error(error instanceof SyntaxError || error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
    ? '观测不是完整的 UTF-8 MySQL JSON 行' : error.message);
  process.exitCode = 2;
});

module.exports = { sql, checkObservation };
