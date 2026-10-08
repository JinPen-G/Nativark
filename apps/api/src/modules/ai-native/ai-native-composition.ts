export type AiNativeComponent = 'router' | 'capabilityEvidence' | 'admission' | 'usageAccounting' | 'gateway' | 'knowledge' | 'memory' | 'humanConfirmation' | 'transport' | 'audit';
export interface AiNativeWiring { [key: string]: unknown; router: unknown; capabilityEvidence: unknown; admission: unknown; usageAccounting: unknown; gateway: unknown; knowledge: unknown; memory: unknown; humanConfirmation: unknown; transport: unknown; audit: unknown; }
export interface WiringCheck { component: AiNativeComponent; present: boolean; enabled: boolean; reason?: string; }
const components: readonly AiNativeComponent[] = ['router', 'capabilityEvidence', 'admission', 'usageAccounting', 'gateway', 'knowledge', 'memory', 'humanConfirmation', 'transport', 'audit'];
/** Explicit composition check. It does not create providers or register public routes. */
const requiredMethods: Record<AiNativeComponent, readonly string[]> = {
  router: ['resolve'], capabilityEvidence: ['preflight', 'record'], admission: ['admit', 'transition'],
  usageAccounting: ['reserve', 'settle', 'release', 'reconcile'], gateway: ['invoke', 'stream'],
  knowledge: ['create', 'withdraw', 'search'], memory: ['putMemory', 'activeMemory'],
  humanConfirmation: ['requestConfirmation', 'confirm'], transport: ['invoke', 'stream'], audit: ['append']
};
export function inspectAiNativeWiring(wiring: Partial<AiNativeWiring>): WiringCheck[] { return components.map(component => { const value = wiring[component] as Record<string, unknown> | null | undefined; const missing = requiredMethods[component].filter(method => typeof value?.[method] !== 'function'); const present = missing.length === 0; return { component, present, enabled: present, ...(present ? {} : { reason: value ? `MISSING_METHODS:${missing.join(',')}` : 'NOT_WIRED' }) }; }); }
export function assertAiNativeWiring(wiring: Partial<AiNativeWiring>): void { const missing = inspectAiNativeWiring(wiring).filter(item => !item.present).map(item => item.component); if (missing.length) throw new Error(`AI_NATIVE_WIRING_INCOMPLETE:${missing.join(',')}`); }
