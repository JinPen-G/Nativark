const assert = require("node:assert/strict");
const { createOwnedDatabase } = require("./helpers/e2e-database-ownership.cjs");
for (const name of [undefined, "rental_os", "rental_os_e2e", "rental_os_e2e_x';DROP", "rental_os_e2e_" + "a".repeat(60)]) {
  assert.throws(() => createOwnedDatabase(name, () => { throw Error("must not execute"); }), /Explicit/);
}
for (const result of ["existing_count\n1", "unknown", ""]) {
  const calls = [];
  assert.throws(() => createOwnedDatabase("rental_os_e2e_guard", sql => { calls.push(sql); return result; }), /refusing/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("SELECT"));
}
const calls = [];
const cleanup = createOwnedDatabase("rental_os_e2e_guard", sql => { calls.push(sql); return "existing_count\n0"; });
assert.equal(calls.length, 2);
assert.ok(calls[1].startsWith("CREATE DATABASE"));
assert.ok(!calls[1].includes("IF NOT EXISTS"));
cleanup(); cleanup();
assert.equal(calls.length, 3);
assert.ok(calls[2].startsWith("DROP DATABASE"));
assert.throws(() => createOwnedDatabase("rental_os_e2e_race", sql => {
  if (sql.startsWith("CREATE")) throw Error("Concurrent database exists");
  assert.ok(!sql.startsWith("DROP"));
  return "existing_count\n0";
}), /Concurrent/);
console.log("PASS database ownership: explicit names, absent precheck, no overwrite, race rejection, owned cleanup only");
