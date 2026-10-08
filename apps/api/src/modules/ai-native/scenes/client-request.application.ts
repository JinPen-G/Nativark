import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { composeAiClientScenes, createAiGuardedClientSession } from '../client-scene.composition';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';

const id = z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const configurationSchema = z.object({ enabled: z.literal(true), tenantCode: id, serviceCode: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), appId: id.optional() }).strict();
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog') }).strict(), z.object({ kind: z.literal('help') }).strict(),
  z.object({ kind: z.literal('profile') }).strict(), z.object({ kind: z.literal('order'), orderId: id }).strict(),
  z.object({ kind: z.literal('cancellation_preview'), orderId: id }).strict()
]);
const sourceSchema = z.object({ materialRef: z.string().uuid() }).strict();
const bearerSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
export type AiClientRequestConfiguration = z.infer<typeof configurationSchema>;
export type AiClientApplicationRequest = { headers: { authorization?: unknown }; ip?: string };
export type AiClientRequestDependencies = {
  client: Parameters<typeof composeAiClientScenes>[0]['client'];
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  clock?: () => Date;
};
type Command = z.infer<typeof commandSchema>;
const fail = (code: 'AI_CLIENT_INVALID_INPUT' | 'AI_CLIENT_CONTEXT_UNAVAILABLE' | 'AI_CLIENT_CAPABILITY_UNAVAILABLE' | 'AI_CLIENT_MATERIAL_STALE'): never => { throw new Error(code); };
const maxBytes = 65536, lifetimeMs = 300000, capacity = 128;

export function composeRequestBoundClientApplication(dependencies: AiClientRequestDependencies, configuration: AiClientRequestConfiguration) {
  const parsed = configurationSchema.safeParse(structuredClone(configuration));
  if (!parsed.success || typeof dependencies.guard?.canActivate !== 'function'
    || 'session' in dependencies || 'credentials' in dependencies) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
  const server = freezeOriginalInput(parsed.data), clock = dependencies.clock ?? (() => new Date());
  const guest = composeAiClientScenes({ client: dependencies.client }).guest;
  const publication = async () => {
    const bootstrap = await guest.bootstrap(server.tenantCode, server.channel, server.appId);
    const services = bootstrap.services.filter(service => service.code === server.serviceCode && service.status === 'open');
    if (bootstrap.tenantCode !== server.tenantCode || bootstrap.client !== server.channel || bootstrap.source !== 'channel'
      || !bootstrap.capabilities.publicCatalog || services.length !== 1) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    const service = services[0];
    return freezeOriginalInput({ tenantCode: bootstrap.tenantCode, channel: bootstrap.client,
      service: { code: service.code, name: service.name, categoryCode: service.categoryCode, status: service.status } });
  };
  const materialHash = (command: Command, value: unknown) => {
    if (command.kind === 'cancellation_preview' && value && typeof value === 'object' && 'calculatedAt' in value) {
      // A new observation time alone does not change the estimated cancellation fee.
      const { calculatedAt: _observation, ...facts } = value;
      return requestFingerprint(facts);
    }
    return requestFingerprint(value);
  };
  const observe = async (request: AiClientApplicationRequest, command: Command, expectedBinding?: string) => {
    const member = !['catalog', 'help'].includes(command.kind);
    const header = member ? bearerSchema.safeParse(request?.headers?.authorization) : undefined;
    if (member && !header?.success) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    const credential = Object.freeze({ authorization: header?.success ? header.data : '', ip: request?.ip });
    let active = true;
    try {
      return await runWithRequestIdentity({}, async () => {
        if (!member) {
          const path = `/api/client/v1/${command.kind === 'catalog' ? 'public/catalog' : 'public/documents/help'}`;
          const publicRequest = { method: 'GET', url: path, originalUrl: path, headers: {}, ip: credential.ip,
            query: { tenantCode: server.tenantCode, ...(command.kind === 'catalog' ? { service: server.serviceCode } : {}) }, body: {} };
          if (await dependencies.guard.canActivate(new ExecutionContextHost([publicRequest])) !== true) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        }
        const source = member ? createAiGuardedClientSession(dependencies.guard, { current: async () => {
          if (!active) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
          return { ...credential };
        } }) : undefined;
        const before = await publication(), identity = source ? await source.current() : null;
        if (identity && (identity.tenantCode !== server.tenantCode || identity.workspaceCode !== server.serviceCode
          || identity.categoryCode !== before.service.categoryCode)) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const bindingHash = requestFingerprint({ publication: before, identity });
        if (expectedBinding && bindingHash !== expectedBinding) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const scenes = composeAiClientScenes({ client: dependencies.client, ...(source ? { session: source } : {}) });
        let material: unknown;
        switch (command.kind) {
          case 'catalog': material = await scenes.guest.catalog(server.tenantCode, server.serviceCode); break;
          case 'help': material = await scenes.guest.help(server.tenantCode); break;
          case 'profile': material = await scenes.member.profile(); break;
          case 'order': material = await scenes.member.order(command.orderId); break;
          case 'cancellation_preview': material = await scenes.member.cancellationPreview(command.orderId); break;
        }
        if (Buffer.byteLength(JSON.stringify(material), 'utf8') > maxBytes) return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        const after = await publication(), current = source ? await source.current() : null;
        if (bindingHash !== requestFingerprint({ publication: after, identity: current })) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        return freezeOriginalInput({ material, materialHash: materialHash(command, material), bindingHash, publication: before });
      });
    } finally { active = false; }
  };
  const packet = (materialRef: string, command: Command, observed: Awaited<ReturnType<typeof observe>>, expiresAt: number) => freezeOriginalInput({
    materialRef, kind: command.kind, material: observed.material, materialHash: observed.materialHash,
    source: { materialRef, tenantCode: server.tenantCode, serviceCode: server.serviceCode, channel: server.channel },
    publication: observed.publication, expiresAt: new Date(expiresAt).toISOString(),
    trust: 'client_api_projection_not_model_instructions' as const, durability: 'process_local_five_minutes_not_task_history' as const,
    handoff: command.kind === 'cancellation_preview' ? { method: 'POST' as const,
      path: `/api/client/v1/orders/${encodeURIComponent(command.orderId)}/cancel`, requiredBodyFields: ['reason'],
      confirmation: 'explicit_human_action' as const, execution: 'not_attempted' as const } : null,
    model: 'unavailable_client_execution_contract_missing' as const, automaticExecution: false as const
  });
  const materials = new Map<string, { command: Command; bindingHash: string; expiresAt: number; packet: ReturnType<typeof packet> }>();
  const sweep = () => { for (const [key, entry] of materials) if (entry.expiresAt <= clock().getTime()) materials.delete(key); };
  return Object.freeze({
    async prepare(request: AiClientApplicationRequest, value: unknown) {
      const input = commandSchema.safeParse(structuredClone(value));
      if (!input.success) return fail('AI_CLIENT_INVALID_INPUT');
      const command = freezeOriginalInput(input.data), observed = await observe(request, command);
      const materialRef = randomUUID(), expiresAt = clock().getTime() + lifetimeMs;
      const result = packet(materialRef, command, observed, expiresAt);
      sweep();
      while (materials.size >= capacity) materials.delete(materials.keys().next().value!);
      materials.set(materialRef, { command, bindingHash: observed.bindingHash, expiresAt, packet: result });
      return result;
    },
    async readSource(request: AiClientApplicationRequest, value: unknown) {
      const input = sourceSchema.safeParse(structuredClone(value));
      if (!input.success) return fail('AI_CLIENT_INVALID_INPUT');
      sweep();
      const entry = materials.get(input.data.materialRef);
      if (!entry) return fail('AI_CLIENT_MATERIAL_STALE');
      const observed = await observe(request, entry.command, entry.bindingHash);
      if (observed.materialHash !== entry.packet.materialHash || entry.expiresAt <= clock().getTime()
        || materials.get(input.data.materialRef) !== entry) return fail('AI_CLIENT_MATERIAL_STALE');
      return freezeOriginalInput({ ...entry.packet, verifiedAt: clock().toISOString() });
    },
    capabilities: Object.freeze({ materialKinds: ['catalog', 'help', 'profile', 'order', 'cancellation_preview'] as const,
      tasks: 'unavailable' as const, models: 'unavailable' as const, events: 'unavailable' as const,
      downloads: 'unavailable' as const, historyMigration: 'unavailable' as const,
      excluded: ['operator_tools', 'staff_tools', 'tenant_inventory', 'costs', 'review_notes', 'model_urls'] as const })
  });
}
