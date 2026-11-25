/** 原归还异常的修订与 JSON 来源核对；不写库、不判责，也不把模型输出当检查事实。 */
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

export function returnExceptionSource(row: { id: string; tenantId: string; workspaceId: string; orderId: string;
  stage: string; revision: number; results: unknown; exceptions: unknown; attachments: unknown }, exceptionId: string) {
  if (row.stage !== 'return' || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 4294967294
    || !Array.isArray(row.exceptions) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(exceptionId)) return undefined;
  const matches = row.exceptions.filter((value): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value) && value.id === exceptionId);
  if (matches.length !== 1) return undefined;
  const exception = matches[0];
  if (!['pending', 'approved', 'rejected'].includes(String(exception.reviewStatus))) return undefined;
  return { revision: row.revision, orderId: row.orderId, failed: exception.reviewStatus === 'pending',
    sourceHash: requestFingerprint(row) };
}
