"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_SELECTED_QUOTE_TASK_HTTP_DRAFT = exports.AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT = exports.AI_QUOTE_SELECTION_HTTP_DRAFT = exports.AI_QUOTE_SELECTION_DRAFT_VERSION = void 0;
exports.AI_QUOTE_SELECTION_DRAFT_VERSION = 'ain-quote-selection-draft-1';
/** Opt-in only; registration does not grant identity, approval or execution. */
exports.AI_QUOTE_SELECTION_HTTP_DRAFT = Object.freeze({
    basePath: 'ai-native/quote-selections', select: '', read: 'read', reconcile: 'reconcile'
});
/** Human review/decision transport only. Core execution remains runner-owned. */
exports.AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT = Object.freeze({
    basePath: `${exports.AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/approval`,
    readSelectedProposal: 'review', decideSelectedProposal: 'decide', readSelectedDecisionReceipt: 'decision-receipt',
    readSelectedOrderResult: 'order-result', readSelectedReprepareEligibility: 'reprepare-eligibility',
    reprepareSelectedProposal: 'reprepare', readSelectedReprepareReceipt: 'reprepare-receipt'
});
exports.AI_SELECTED_QUOTE_TASK_HTTP_DRAFT = Object.freeze({
    basePath: `${exports.AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/task`,
    start: 'start', readConfirmation: 'confirmation', continueConfirmation: 'continue', reconcile: 'reconcile', requestCancel: 'cancel',
    readResult: 'result', readScene: 'scene', readTaskPage: 'tasks', readTaskEvents: 'events'
});
//# sourceMappingURL=ai-quote-selection-draft.js.map