/** 原 Rental Gateway facade，注册原严格工具参加者并委托公共单一执行器。 */
import { UnifiedAiGatewayService as PublicUnifiedAiGatewayService,
  type UnifiedGatewayPorts, type GatewayTextIntentBinding } from '@rental-os/platform-server/ai-gateway';
import { rentalGatewayToolResultPolicy } from './gateway-tool-policy';
export class UnifiedAiGatewayService extends PublicUnifiedAiGatewayService {
  constructor(ports: UnifiedGatewayPorts, deadlineMs = 120_000, intentBinding?: GatewayTextIntentBinding) {
    super(ports, deadlineMs, intentBinding, rentalGatewayToolResultPolicy);
  }
}
