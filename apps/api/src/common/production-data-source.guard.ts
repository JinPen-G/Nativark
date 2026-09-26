/** Production writes must use the shared persistent database, never the dev memory adapter. */
export function assertProductionDataSource(nodeEnv: string | undefined, configuredSource: string | undefined): string {
  const source = (configuredSource ?? "mysql").trim().toLowerCase();
  if ((nodeEnv ?? "").trim().toLowerCase() !== "production") return source;
  if (source !== "mysql") {
    throw new Error("Production API requires PLATFORM_DATA_SOURCE=mysql; in-memory data sources are development/test only.");
  }
  return source;
}
