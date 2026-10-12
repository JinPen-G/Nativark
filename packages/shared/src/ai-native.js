"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_ERROR_CODES = exports.AI_TOOL_CODES = exports.AI_TOOL_DRAFT_VERSION = exports.AI_CONTRACT_DRAFT_VERSION = void 0;
exports.AI_CONTRACT_DRAFT_VERSION = "ain-c01-c02-draft-1";
exports.AI_TOOL_DRAFT_VERSION = "draft-1";
exports.AI_TOOL_CODES = Object.freeze([
    "rental.order.explain", "rental.catalog.search", "rental.availability.check",
    "membership.customer.resolve", "rental.quote.preview", "rental.order.propose",
    "rental.order.commit", "rental.change.preview", "tenant.opening.diagnose",
    "tenant.config.propose", "tenant.notifications.commit", "membership.profile.propose", "inspection.draft.extract",
    "operations.risks.list", "platform.category.propose"
]);
exports.AI_ERROR_CODES = Object.freeze([
    "AI_DISABLED", "AI_PROVIDER_UNAVAILABLE", "AI_BUDGET_EXCEEDED", "AI_TOOL_UNAVAILABLE",
    "AI_SCOPE_CHANGED", "AI_APPROVAL_EXPIRED", "AI_PROPOSAL_STALE", "AI_RESULT_UNKNOWN",
    "AI_INVALID_INPUT", "AI_UNSUPPORTED_VERSION", "AI_ACCESS_DENIED", "AI_BUSINESS_REJECTED"
]);
//# sourceMappingURL=ai-native.js.map