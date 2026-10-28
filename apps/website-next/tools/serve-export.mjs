// Preview only the generated static export. Production can host out/ on any
// suitable static web server; this does not run business APIs or read .env files.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../out",
);
const portArgument = process.argv.indexOf("--port");
const port = Number(
  (portArgument >= 0 ? process.argv[portArgument + 1] : undefined) ||
    process.env.PORT ||
    8140,
);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid preview port");
const types = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/x-component; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
await fs.access(path.join(root, "index.html"));
const { basePath = "" } = JSON.parse(await fs.readFile(path.join(root, "site-config.json"), "utf8").catch(() => "{}"));
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (basePath) {
    if (pathname === basePath) {
      res.writeHead(302, { Location: basePath + "/" }).end();
      return;
    }
    if (!pathname.startsWith(basePath + "/")) {
      res.writeHead(404).end();
      return;
    }
    pathname = pathname.slice(basePath.length);
  }
  const page = /^(?:\/(?:en\/)?harness\/?|\/)$/u.test(pathname);
  const route = page
    ? pathname.replace(/\/$/, "") +
      "/" +
      (req.headers.rsc === "1" ? "index.txt" : "index.html")
    : pathname;
  const filename = path.resolve(root, "." + route);
  if (!filename.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let bytes;
    try {
      bytes = await fs.readFile(filename);
    } catch (error) {
      // Next.js 16 export stores prefetched segment payloads in nested folders.
      const segmentFile = filename.replace(
        /(__next\.[^.\\/]+)\.([^\\/]+)\.txt$/,
        (_, prefix, segments) =>
          prefix + path.sep + segments.split(".").join(path.sep) + ".txt",
      );
      if (segmentFile === filename) throw error;
      bytes = await fs.readFile(segmentFile);
    }
    res
      .writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      })
      .end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
  }
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    "Rental OS static export: http://127.0.0.1:" + port + basePath + "/harness/",
  ),
);
