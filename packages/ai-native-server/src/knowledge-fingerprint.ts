/** 原知识与删除收据指纹；保留 JSON 属性顺序，不能替换为排序后的 requestFingerprint。 */
import { createHash } from 'node:crypto';

export function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
