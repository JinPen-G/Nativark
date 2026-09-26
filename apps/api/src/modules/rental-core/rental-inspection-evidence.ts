export function inspectionEvidenceIds(input: {
  attachments?: string[];
  results?: Record<string, unknown>;
  handoverSignatureFileAssetId?: string;
}): string[] {
  const values = [...(input.attachments ?? [])];
  for (const value of Object.values(input.results ?? {})) {
    if (Array.isArray(value)) values.push(...value.filter((item): item is string => typeof item === "string"));
  }
  if (input.handoverSignatureFileAssetId) values.push(input.handoverSignatureFileAssetId);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function inspectionEvidenceRequiredError(required: boolean, fileIds: string[]): string | undefined {
  return required && fileIds.length === 0 ? "当前经营规则要求领取/归还检查至少附带一份现场影像凭证" : undefined;
}
