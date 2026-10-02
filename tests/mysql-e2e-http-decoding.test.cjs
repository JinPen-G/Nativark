const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");

// Exercise the actual harness helper without booting its database/API main.
const source = fs.readFileSync(path.join(__dirname, "mysql-e2e.test.cjs"), "utf8");
const begin = source.indexOf("function request(method,");
const end = source.indexOf("async function probePort()", begin);
assert.ok(begin >= 0 && end > begin);
const fixtures = [JSON.stringify({ label: "外观完好", nested: ["换货🙂", "摄影"] }), "加载中🙂"];
const server = http.createServer(async (req, res) => {
  const fixture = fixtures[Number(req.url.slice(1))];
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  // Each write is a separate HTTP chunk, including partial UTF-8 characters.
  for (const byte of Buffer.from(fixture, "utf8")) {
    res.write(Buffer.from([byte]));
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  res.end();
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const context = vm.createContext({ http, URL, Buffer, API_BASE: `http://127.0.0.1:${server.address().port}` });
    vm.runInContext(`${source.slice(begin, end)}; globalThis.send = request;`, context);
    for (const [index, fixture] of fixtures.entries()) {
      const response = await context.send("GET", `/${index}`);
      assert.equal(response.status, 200);
      assert.equal(typeof response.body === "string" ? response.body : JSON.stringify(response.body), fixture);
    }
    console.log("PASS MySQL E2E HTTP client preserves split UTF-8 JSON and plain text");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
