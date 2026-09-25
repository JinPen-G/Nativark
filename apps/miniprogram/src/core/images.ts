import { apiUrl, authHeaders } from "./http";

/**
 * 受保护图片加载。商品图片接口需要客户端令牌，而 <image> 无法附带请求头，
 * 因此用 wx.downloadFile 带 Authorization 下载到临时文件后再展示。
 * 同一地址只下载一次；失败返回空串，由页面显示中性占位，不用其他商品图冒充。
 */
const cache = new Map<string, Promise<string>>();
const MAX_CACHE = 200;
const MAX_CONCURRENT = 4;
let active = 0;
const queue: Array<() => void> = [];

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active += 1;
      task().then(resolve, reject).then(() => {
        active -= 1;
        const next = queue.shift();
        if (next) next();
      });
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

function download(url: string): Promise<string> {
  return new Promise<string>((resolve) => {
    wx.downloadFile({
      url,
      header: authHeaders(),
      success: (res) => resolve(res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath ? res.tempFilePath : ""),
      fail: () => resolve("")
    });
  });
}

export function resolveImage(source: string | undefined | null): Promise<string> {
  if (!source) return Promise.resolve("");
  if (/^(https?:)?\/\//i.test(source) || source.startsWith("data:") || source.startsWith("wxfile://") || source.startsWith("http://tmp/")) {
    return Promise.resolve(source);
  }
  const url = source.startsWith("/api/") ? apiUrl(source) : source;
  const existing = cache.get(url);
  if (existing) return existing;
  const pending = schedule(() => download(url)).then((path) => {
    if (!path) cache.delete(url);
    return path;
  });
  cache.set(url, pending);
  // 有界缓存：超出上限按插入顺序淘汰最早的，避免长会话内 Map 无限增长。
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

export function clearImageCache(): void {
  cache.clear();
}
