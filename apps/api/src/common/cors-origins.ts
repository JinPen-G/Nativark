/** CORS 只是浏览器跨域配置，不代替接口鉴权或公开提交限流。 */
export function apiCorsOrigins(value = ""): Array<string | RegExp> {
  const origins: Array<string | RegExp> = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
  for (const entry of value.split(",").map((part) => part.trim()).filter(Boolean)) {
    const url = new URL(entry);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")) {
      throw new Error("CORS_ALLOWED_ORIGINS 必须是逗号分隔的完整 HTTPS origin，不含路径或通配符");
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}
