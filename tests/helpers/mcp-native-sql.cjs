"use strict";
/** Test-only tagged SQL driver for the owned MySQL instance. Each transaction is
 * a separate native connection, not a JS lock substitute or PrismaClient. Uses
 * real PREPARE/parameters/locks; preserves source WHERE/FOR UPDATE and maps only
 * bare SELECT columns into native JSON rows. No production authority or retry. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const textLiteral = value => 'CONVERT(0x' + Buffer.from(value, 'utf8').toString('hex') + ' USING utf8mb4)';
function parameter(value) {
  if (typeof value === 'string') return value.length ? textLiteral(value) : "''";
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0));
  return String(value);
}
function prepared(parts, values, query) {
  assert.ok(Array.isArray(parts.raw) && parts.length === values.length + 1);
  let source = parts.join('?').trim();
  assert.doesNotMatch(source, /;|--|\/\*|\b(?:USE|DROP|LOAD|OUTFILE|INFILE|GRANT|REVOKE|PROCEDURE|TRIGGER)\b/i);
  assert.match(source, /^(?:SELECT|INSERT INTO|UPDATE|CREATE TABLE (?:mcp_native_|ai_task_original_requests\b))/i);
  // The one original-request table is a named owned-test fixture, not permission
  // to query arbitrary ai_* tables or another schema. Keep all other limits.
  for (const match of source.matchAll(/(?:\b(?:FROM|INTO|TABLE)|^UPDATE)\s+([a-z0-9_]+)/gi))
    assert.ok(/^mcp_/.test(match[1]) || match[1] === 'ai_task_original_requests');
  if (query) {
    const selected = source.match(/^SELECT ([a-z0-9_,\s]+) FROM /i);
    assert.ok(selected, 'Only original bare-column SELECT projections are supported');
    const columns = selected[1].split(',').map(value => value.trim());
    assert.ok(columns.length > 0 && columns.every(value => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)));
    // Server JSON preserves actual JSON/null/numeric types, rather than inventing
    // fixture rows from SQL text. All source predicates and locks stay unchanged.
    source = source.replace(/^SELECT [a-z0-9_,\s]+ FROM /i,
      'SELECT JSON_OBJECT(' + columns.map(value => "'" + value + "', " + value).join(', ') + ') FROM ');
  }
  const binds = values.map((value, i) => 'SET @mcp_native_p' + i + '=' + parameter(value) + ';').join('\n');
  return 'SET @mcp_native_sql=' + textLiteral(source) + ';\nPREPARE mcp_native_statement FROM @mcp_native_sql;\n' + binds + '\nEXECUTE mcp_native_statement'
    + (values.length ? ' USING ' + values.map((_, i) => '@mcp_native_p' + i).join(', ') : '') + ';\n'
    + (query ? '' : 'SELECT ROW_COUNT();\n') + 'DEALLOCATE PREPARE mcp_native_statement;\n';
}
function createNativeSqlDatabase({ executable, args, env, cwd, directory, assertOwned }) {
  let transactions = 0; const connectionIds = [];
  async function transaction(consume, options) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    assertOwned(); transactions++;
    const output = path.join(directory, 'native-session-' + randomBytes(8).toString('hex') + '.log');
    const fd = fs.openSync(output, 'wx');
    // One shared descriptor keeps errors and the completion marker ordered. Logs
    // contain result rows/errors, never echoed stdin or the password/connection URL.
    let child;
    try { child = spawn(executable, [...args, '--force', '--silent', '--unbuffered'], { cwd, env, windowsHide: true, stdio: ['pipe', fd, fd] }); }
    finally { fs.closeSync(fd); }
    let closed = false, exitCode, spawnFailure, cursor = 0, expired = false, active = true, chain = Promise.resolve();
    const exit = new Promise(resolve => {
      child.once('error', error => { spawnFailure = error; });
      child.once('close', code => { closed = true; exitCode = code; resolve(); });
    });
    child.stdin.on('error', () => {});
    const deadline = Date.now() + options.timeout;
    const timer = setTimeout(() => { expired = true; child.kill(); }, options.timeout);
    async function frame(sql) {
      assert.ok(active && !expired && !closed && !spawnFailure, 'Owned native SQL connection is unavailable');
      assertOwned();
      const marker = 'mcp_native_done_' + randomBytes(12).toString('hex');
      child.stdin.write(sql + "\nSELECT '" + marker + "';\n");
      while (Date.now() < deadline && !expired) {
        const data = fs.readFileSync(output, 'utf8');
        assert.ok(Buffer.byteLength(data, 'utf8') <= 1048576, 'Native transaction evidence exceeded its bound');
        const rest = data.slice(cursor), complete = rest.match(new RegExp('^' + marker + '\\r?\\n', 'm'));
        if (complete) {
          cursor += complete.index + complete[0].length;
          const lines = rest.slice(0, complete.index).trim().split(/\r?\n/).filter(Boolean);
          if (lines.some(line => /^ERROR\b/.test(line))) throw new Error('Owned native SQL statement failed; inspect retained session evidence');
          return lines;
        }
        if (closed || spawnFailure) throw new Error('Owned native SQL connection ended before acknowledgement');
        await pause(10);
      }
      throw new Error('Owned native SQL transaction deadline exceeded; commit may be unknown');
    }
    function ordered(sql) {
      const result = chain.then(() => frame(sql));
      chain = result.catch(() => {}); return result;
    }
    const native = {
      async $queryRaw(parts, ...values) { return (await ordered(prepared(parts, values, true))).map(line => JSON.parse(line)); },
      async $executeRaw(parts, ...values) {
        const lines = await ordered(prepared(parts, values, false));
        assert.equal(lines.length, 1); const count = Number(lines[0]); assert.ok(Number.isSafeInteger(count) && count >= 0); return count;
      },
    };
    try {
      const identity = await ordered('SELECT CONNECTION_ID(); SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; START TRANSACTION;');
      assert.equal(identity.length, 1); const connectionId = Number(identity[0]); assert.ok(Number.isSafeInteger(connectionId) && connectionId > 0);
      connectionIds.push(connectionId);
      const result = await consume(native); await chain;
      await ordered('COMMIT;'); return result;
    } catch (error) {
      try { if (!expired && !closed) await ordered('ROLLBACK;'); } catch { /* Never infer rollback or retry an unknown statement. */ }
      throw error;
    } finally {
      active = false; clearTimeout(timer);
      if (!child.stdin.destroyed) child.stdin.end();
      const kill = setTimeout(() => { if (!closed) child.kill(); }, 2500);
      await exit; clearTimeout(kill);
      if (exitCode !== 0 && !expired) throw new Error('Owned native SQL connection did not close cleanly');
    }
  }
  const options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
  return Object.freeze({ $transaction: transaction,
    $queryRaw: (parts, ...values) => transaction(tx => tx.$queryRaw(parts, ...values), options),
    $executeRaw: (parts, ...values) => transaction(tx => tx.$executeRaw(parts, ...values), options),
    stats: () => ({ transactions, connectionIds: [...connectionIds] }) });
}
module.exports = { createNativeSqlDatabase };
