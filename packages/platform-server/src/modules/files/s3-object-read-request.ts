/** 构造原 S3 兼容对象 GET 的路径和请求头签名。实际出站校验、对象读取及当前业务授权由调用方承担。 */
import { createHash, createHmac } from 'node:crypto';
import type { TenantIntegrationRuntimeConfig } from '../integrations/tenant-integration.service';

const unavailable = () => new Error('Inspection object storage unavailable');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/gu, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const value = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || /[\r\n]/u.test(v)) throw unavailable(); return v.trim(); };

export function s3ObjectReadRequest(config: TenantIntegrationRuntimeConfig, storageKey: string, at: Date) {
  if (config.provider !== 's3_compatible' || !Number.isFinite(at.getTime())) throw unavailable();
  const bucket = value(config.settings.bucket), region = value(config.settings.region);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) || !/^[a-z0-9-]+$/u.test(region)
    || !storageKey || storageKey.length > 2048 || storageKey.split('/').some(p => p === '.' || p === '..' || !p)
    || /[\u0000-\u001f\u007f\\]/u.test(storageKey)) throw unavailable();
  const url = new URL(value(config.settings.endpoint));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw unavailable();
  const pathStyle = config.settings.forcePathStyle === true || String(config.settings.forcePathStyle).toLowerCase() === 'true';
  if (!pathStyle) url.hostname = `${bucket}.${url.hostname}`;
  const path = `/${pathStyle ? `${encode(bucket)}/` : ''}${storageKey.split('/').map(encode).join('/')}`;
  url.pathname = path;
  const amzDate = at.toISOString().replace(/[:-]|\.\d{3}/gu, ''), date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`, payloadHash = hash('');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = `GET\n${path}\n\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\n${signedHeaders}\n${payloadHash}`;
  const key = mac(mac(mac(mac(`AWS4${value(config.credentials.secretAccessKey)}`, date), region), 's3'), 'aws4_request');
  const signature = mac(key, `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonical)}`).toString('hex');
  return { url: url.toString(), headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${value(config.credentials.accessKeyId)}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` } };
}
