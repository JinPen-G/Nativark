"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_ENTRY_ACTION_REGISTRY = exports.AI_ENTRY_ACTION_CODES = exports.AI_CUSTOMER_ENTRY_SURFACES = exports.AI_ENTRY_AUDIENCE_MAP = exports.AI_ENTRY_ACTION_CONTRACT_VERSION = void 0;
exports.AI_ENTRY_ACTION_CONTRACT_VERSION = 'ain-entry-action-draft-1';
exports.AI_ENTRY_AUDIENCE_MAP = { operations: 'operator', staff: 'staff', customer: 'client', platform: 'platform' };
exports.AI_CUSTOMER_ENTRY_SURFACES = ['client_miniprogram', 'tenant_website'];
exports.AI_ENTRY_ACTION_CODES = ['OPEN_ORDER', 'OPEN_CUSTOMER', 'OPEN_PRODUCT', 'OPEN_BOOKING', 'OPEN_PROFILE',
    'OPEN_PAYMENT', 'OPEN_DISPATCH', 'CREATE_BOOKING_DRAFT', 'CREATE_NOTIFICATION_DRAFT'];
exports.AI_ENTRY_ACTION_REGISTRY = {
    OPEN_ORDER: { resourceKind: 'order', riskLevel: 'R0', requiresConfirmation: false, availability: 'requires_server_assembly' },
    CREATE_BOOKING_DRAFT: { resourceKind: 'quote', riskLevel: 'R1', requiresConfirmation: true, availability: 'requires_server_assembly' },
    OPEN_BOOKING: { resourceKind: 'booking_draft', riskLevel: 'R0', requiresConfirmation: false, availability: 'requires_server_assembly' },
    OPEN_CUSTOMER: { availability: 'unavailable' }, OPEN_PRODUCT: { availability: 'unavailable' },
    OPEN_PROFILE: { availability: 'unavailable' }, OPEN_PAYMENT: { availability: 'unavailable' },
    OPEN_DISPATCH: { availability: 'unavailable' }, CREATE_NOTIFICATION_DRAFT: { availability: 'unavailable' }
};
//# sourceMappingURL=ai-entry-action-draft.js.map