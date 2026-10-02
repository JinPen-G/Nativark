const assert = require("node:assert/strict");

function createOwnedDatabase(name, execute) {
  assert.ok(typeof name === "string" && /^rental_os_e2e_[a-z0-9_]+$/u.test(name) && name.length <= 63,
    "Explicit rental_os_e2e_* database name required");
  const result = execute(`SELECT COUNT(*) AS existing_count FROM information_schema.schemata WHERE schema_name = '${name}';`);
  assert.match(String(result), /(?:^|\n)0\s*$/u, "Database already exists or precheck result is invalid; refusing to overwrite");
  // No IF NOT EXISTS: a concurrent creator must make this fail, never become ours.
  execute(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  let owned = true;
  return () => {
    if (!owned) return;
    execute(`DROP DATABASE \`${name}\`;`);
    owned = false;
  };
}

module.exports = { createOwnedDatabase };
