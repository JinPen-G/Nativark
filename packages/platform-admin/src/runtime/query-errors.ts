/** 只分类读取失败；永久拒绝不能借旧缓存继续显示受保护内容。 */
export function isTransientRefreshError(error: unknown): boolean {
  const failure = error as { response?: { status?: number }; code?: string } | null;
  const status = failure?.response?.status;
  return Boolean(status && (status >= 500 || status === 408 || status === 429)
    || failure?.code && ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"].includes(failure.code));
}
