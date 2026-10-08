let nextInstance = 0;
export function makeAiInstanceId(prefix = "ai") { nextInstance += 1; return `${prefix}-${nextInstance}`; }
