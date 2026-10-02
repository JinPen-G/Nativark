"use strict";
// Synthetic inputs only, never contacted. No address classification algorithm here.
const privateUrls = [
  "https://localhost/", "https://LOCALHOST./", "https://metadata.google.internal/",
  "https://host.docker.internal/", "https://127.0.0.1/", "https://2130706433/",
  "https://0x7f000001/", "https://10.1.2.3/", "https://172.16.0.1/", "https://192.168.1.1/",
  "https://169.254.169.254/", "https://100.64.0.1/", "https://198.18.0.1/",
  "https://[::1]/", "https://[fd00::1]/", "https://[fe80::1]/", "https://[::ffff:127.0.0.1]/"
];
const malformed = [
  { url: "not a url", error: /有效/u },
  { url: "file:///synthetic", error: /HTTP\(S\)/u },
  { url: "javascript:synthetic", error: /HTTP\(S\)/u },
  { url: "https://synthetic-user:synthetic-pass@public.example.test/", error: /内嵌账号/u },
  { url: "https://public.example.test/?synthetic=1", error: /查询参数/u },
  { url: "https://public.example.test/#synthetic", error: /片段/u },
  { url: "http://public.example.test/", error: /HTTPS/u }
];
module.exports = { privateUrls, malformed };
