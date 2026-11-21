/** 原模型目的地正规化，只处理受控配置，公开地址核验仍由出站策略完成。 */
import { isPrivateOrLocalHost, parseOutboundUrl } from '../common/outbound-url';
import { ModelGatewayError } from './model-gateway.ports';
export function normalizeModelBaseUrl(value: string) {
  try {
    const url = parseOutboundUrl(value, "Model Base URL", { allowPrivateInDevelopment: false });
    if (url.protocol !== "https:" || isPrivateOrLocalHost(url.hostname)) throw new Error();
    return url.toString().replace(/\/+$/u, "");
  } catch { throw new ModelGatewayError("CONFIG_INVALID"); }
}
