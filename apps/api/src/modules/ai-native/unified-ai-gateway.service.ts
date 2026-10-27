import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { AiGatewayIntentDraft } from '@rental-os/shared';
import { gatewayTextIntentBindingSchema, prepareGatewayIntent, prepareGatewayTextIntent, type GatewayTextIntentBinding } from './gateway-intent';
import type { GatewayAccountingCall } from './gateway-accounting.ports';
import type { AiDispatchBinding } from './invocation-dispatch.service';
import type { AiProfileCapability, AiProfileScope } from './provider-profile.ports';
import { GatewayDeadline } from './gateway-deadline';
import { ModelGatewayError, modelProtocolRequestSchema, modelRequestSchema, modelUsageSchema, type GatewayContext, type ModelProtocolRequest, type ModelRequest, type ModelUsage } from './model-gateway.ports';
import type { UnifiedGatewayPorts, GatewayInvocationResult, GatewayStreamEvent } from './unified-ai-gateway.ports';
import { gatewayRoutingBinding } from './gateway-routing.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { isGatewayOrderExplainRequest } from './gateway-contract-validation';

type UnresolvedRequest = Omit<ModelRequest, 'model'> & { model?: string };
type UnresolvedProtocolRequest = Omit<ModelProtocolRequest, 'model'> & { model?: string };
type IntentExecutionBinding = GatewayTextIntentBinding & { intentHash: string };
const textResultSchema = z.object({
  text: z.string(), usage: modelUsageSchema.optional(),
  toolRequests: z.array(z.never()).max(0).optional()
}).strict();

// Internal workspace facade with token-bound dispatch ownership; public C03 mapping remains separate.
export class UnifiedAiGatewayService {
  private readonly intentBinding?: GatewayTextIntentBinding;
  constructor(private readonly ports: UnifiedGatewayPorts, private readonly deadlineMs = 120_000, intentBinding?: GatewayTextIntentBinding) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new ModelGatewayError('CONFIG_INVALID');
    if (intentBinding !== undefined) {
      const parsed = gatewayTextIntentBindingSchema.safeParse(intentBinding);
      if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
      this.intentBinding = Object.freeze(parsed.data);
    }
  }

  // Workspace-only C03 input bridge. Public actual/evidence/result envelopes are not fabricated here.
  private policy(binding: GatewayTextIntentBinding) {
    const { routeScene: _, ...policy } = binding;
    return policy;
  }
  async invokeTextIntent(context: GatewayContext, intent: AiGatewayIntentDraft, signal?: AbortSignal) {
    context = structuredClone(context); intent = structuredClone(intent);
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const binding = this.intentBinding;
    if (!binding) throw new ModelGatewayError('CONFIG_INVALID');
    const life = this.deadline(signal);
    try {
      const prepared = await life.wait(() => prepareGatewayTextIntent(intent, this.policy(binding), 'invoke'));
      return await this.invokeRequest(context, prepared.request, signal, { ...binding, intentHash: prepared.intentHash }, life);
    } finally { life.close(); }
  }

  async *streamTextIntent(context: GatewayContext, intent: AiGatewayIntentDraft, signal?: AbortSignal) {
    context = structuredClone(context); intent = structuredClone(intent);
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const binding = this.intentBinding;
    if (!binding) throw new ModelGatewayError('CONFIG_INVALID');
    const life = this.deadline(signal);
    try {
      const prepared = await life.wait(() => prepareGatewayTextIntent(intent, this.policy(binding), 'stream'));
      yield* this.streamRequest(context, prepared.request, signal, { ...binding, intentHash: prepared.intentHash }, life);
    } finally { life.close(); }
  }

  async invokeIntent(context: GatewayContext, intent: AiGatewayIntentDraft, signal?: AbortSignal) {
    context = structuredClone(context); intent = structuredClone(intent);
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const binding = this.intentBinding;
    if (!binding) throw new ModelGatewayError('CONFIG_INVALID');
    const life = this.deadline(signal);
    try {
      const prepared = await life.wait(() => prepareGatewayIntent(intent, this.policy(binding), 'invoke', context, this.ports.media, life.controller.signal));
      return await this.invokeRequest(context, prepared.request, signal, { ...binding, intentHash: prepared.intentHash }, life);
    } finally { life.close(); }
  }

  async *streamIntent(context: GatewayContext, intent: AiGatewayIntentDraft, signal?: AbortSignal) {
    context = structuredClone(context); intent = structuredClone(intent);
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const binding = this.intentBinding;
    if (!binding) throw new ModelGatewayError('CONFIG_INVALID');
    const life = this.deadline(signal);
    try {
      const prepared = await life.wait(() => prepareGatewayIntent(intent, this.policy(binding), 'stream', context, this.ports.media, life.controller.signal));
      yield* this.streamRequest(context, prepared.request, signal, { ...binding, intentHash: prepared.intentHash }, life);
    } finally { life.close(); }
  }

  private deadline(signal?: AbortSignal) { return new GatewayDeadline(this.deadlineMs, signal); }

  private deliveryTiming(start: number, firstText: number | null = null) {
    const duration = performance.now() - start;
    if (!Number.isFinite(duration) || duration < 0 || firstText !== null && (firstText < 0 || firstText > duration)) {
      throw new ModelGatewayError('INVALID_RESPONSE');
    }
    return { version: 'gateway-delivery-time-1' as const, transportWallMs: Math.floor(duration),
      firstValidatedTextMs: firstText === null ? null : Math.floor(firstText) };
  }

  /** Platform calls carry no tenant/workspace attribution; the audit port
   * records null and the platform audit implementation owns its journal. */
  private attribution(context: Readonly<GatewayContext>): { tenantId: string | null; workspaceId: string | null } {
    return 'tenantId' in context && 'workspaceId' in context
      ? { tenantId: context.tenantId, workspaceId: context.workspaceId } : { tenantId: null, workspaceId: null };
  }
  private async assertMediaCurrent(context: GatewayContext, request: UnresolvedRequest | UnresolvedProtocolRequest, signal: AbortSignal) {
    const references = request.messages.flatMap(message => typeof message.content === 'string' ? []
      : message.content.filter(part => part.kind !== 'text').map(part => ({ kind: part.kind,
        attachmentId: part.attachmentId, attachmentRevision: part.attachmentRevision,
        mediaType: part.mediaType, contentHash: part.contentHash })));
    if (!references.length) return;
    const media = this.ports.media;
    if (typeof media?.assertCurrent !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    try { await media.assertCurrent(structuredClone(context), structuredClone(references), signal); }
    catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('FORBIDDEN'); }
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
  }

  private assertBudget() {
    const budget = this.ports.budget;
    if (typeof this.ports.audit?.append !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    if ([budget?.reserve, budget?.dispatch, budget?.recordUsage, budget?.settle, budget?.abandon]
      .some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }

  private async reserveBudget(call: GatewayAccountingCall, signal: AbortSignal) {
    try { return await this.ports.budget.reserve(structuredClone(call)); }
    catch (error) {
      const observer = this.ports.observation?.budgetDenied ? this.ports.observation : this.ports.audit;
      if (error instanceof ModelGatewayError && error.code === 'BUDGET_UNAVAILABLE' && observer.budgetDenied && !signal.aborted) {
        // Observation is optional and bounded. Its absence/failure must not
        // change a budget denial into permission, refund evidence or a retry.
        const wait = new GatewayDeadline(1000, signal);
        try { await wait.wait(() => observer.budgetDenied!({ call: structuredClone(call), code: 'BUDGET_UNAVAILABLE' }, wait.controller.signal)); }
        catch { /* unrecorded observation stays unrecorded; original denial wins */ }
        finally { wait.close(); }
      }
      throw error;
    }
  }

  private usageRecorder(value: GatewayAccountingCall, reservationId: string) {
    const call = structuredClone(value);
    let fingerprint: string | undefined, pending: Promise<void> | undefined;
    return (valueUsage: ModelUsage): Promise<void> => {
      const parsed = textResultSchema.shape.usage.unwrap().safeParse(valueUsage);
      if (!parsed.success) return Promise.reject(new ModelGatewayError('INVALID_RESPONSE'));
      const usage = parsed.data, hash = requestFingerprint(usage);
      if (pending) return hash === fingerprint ? pending : Promise.reject(new ModelGatewayError('INVALID_RESPONSE'));
      fingerprint = hash;
      // Receipt persistence has its own bounded accounting wait, independent
      // of caller cancellation or revoked text delivery. A lost write response
      // stays unknown: reuse this promise, never automatically write it again.
      const receiptDeadline = new GatewayDeadline(5000);
      pending = receiptDeadline.wait(() => this.ports.budget.recordUsage(structuredClone(call), reservationId, usage))
        .finally(() => receiptDeadline.close());
      return pending;
    };
  }

  private input(request: ModelRequest): ModelRequest {
    const parsed = modelRequestSchema.safeParse(request);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return parsed.data;
  }

  private textResult(value: unknown, structured = false, tools = false): GatewayInvocationResult {
    const parsed = (structured ? textResultSchema.extend({ structuredOutput: z.record(z.unknown()) })
      : tools ? textResultSchema.extend({ toolRequests: z.array(z.unknown()).max(8).optional() }) : textResultSchema).safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_RESPONSE');
    if ((structured || tools) && Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 131072) throw new ModelGatewayError('INVALID_RESPONSE');
    if (tools && parsed.data.toolRequests?.some(value => !isGatewayOrderExplainRequest(value))) throw new ModelGatewayError('INVALID_RESPONSE');
    if (structured) {
      let decoded: unknown;
      try { decoded = JSON.parse(parsed.data.text); } catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
      if (!('structuredOutput' in parsed.data) || requestFingerprint(decoded) !== requestFingerprint(parsed.data.structuredOutput)) {
        throw new ModelGatewayError('INVALID_RESPONSE');
      }
    }
    return parsed.data;
  }

  private required(request: UnresolvedRequest | UnresolvedProtocolRequest, stream = false): AiProfileCapability[] {
    const capabilities: AiProfileCapability[] = ['text'];
    if (stream) capabilities.push('streaming');
    for (const feature of request.features ?? []) {
      if (feature === 'tools') capabilities.push('tools');
      else if (feature === 'structuredOutput') capabilities.push('structured_output');
      else if (feature === 'streaming') capabilities.push('streaming');
      else if (feature === 'image') capabilities.push('vision');
      else if (feature === 'audio') capabilities.push('audio');
      else throw new ModelGatewayError('INVALID_REQUEST');
    }
    return [...new Set(capabilities)];
  }

  async invoke(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): Promise<GatewayInvocationResult> {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    return this.invokeRequest(context, this.input(request), signal);
  }

  private async invokeRequest(context: GatewayContext, request: UnresolvedRequest | UnresolvedProtocolRequest, signal?: AbortSignal, intentBinding?: IntentExecutionBinding, intentLife?: GatewayDeadline): Promise<GatewayInvocationResult> {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    this.assertBudget();
    request = structuredClone(request); context = structuredClone(context);
    // Attachment reads, routing, admission and the provider share one caller
    // deadline/cleanup budget. Resolving media must not buy a second timeout.
    const life = intentLife ?? this.deadline(signal);
    let scope!: AiProfileScope;
    let binding: AiDispatchBinding | undefined;
    let budgetCall: GatewayAccountingCall | undefined;
    let admissionId: string | undefined, reservationId: string | undefined, dispatched = false, accounted = false, settled = false, closed = false;
    try {
      const resolution = structuredClone(await life.wait(() => this.ports.routing.resolve(context, this.required(request))));
      if (intentBinding && resolution.scene !== intentBinding.routeScene) throw new ModelGatewayError('CONFIG_INVALID');
      const route = resolution.route; scope = resolution.consumerScope;
      const parsedTransportRequest = modelProtocolRequestSchema.safeParse({ ...request, model: route.profile.model });
      if (!parsedTransportRequest.success) throw new ModelGatewayError('INVALID_REQUEST');
      const transportRequest = parsedTransportRequest.data;
      request = transportRequest;
      const hash = requestFingerprint({ request, routing: gatewayRoutingBinding(resolution), ...(intentBinding ? { intentBinding } : {}) });
      if (!this.ports.dispatch || typeof this.ports.dispatch.claim !== 'function' || typeof this.ports.dispatch.finish !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
      // Persist readiness before admission/claim/reserve. No presence-only gate.
      const preparation = { context: structuredClone(context), callId: request.callId,
        intentHash: intentBinding?.intentHash ?? hash, requestHash: hash,
        configurationHash: requestFingerprint(route.profile), profile: structuredClone(route.profile), mode: 'invoke' as const };
      if (this.ports.audit.prepare) await life.wait(() => this.ports.audit.prepare!(preparation, life.controller.signal));
      else await life.wait(() => this.ports.audit.append({ callId: request.callId, ...this.attribution(context),
        event: 'ai.invoke.prepared', status: 'prepared', detail: requestFingerprint(preparation) }));
      // An admission may be shared by concurrent attempts. Only a successful claim owns cleanup.
      const admission = await life.wait(() => this.ports.admission.admit({ scope: structuredClone(scope), actorId: context.actorId, callId: request.callId, requestHash: hash, profileId: route.profile.id, expiresAt: life.expiresAt }));
      binding = { scope: structuredClone(scope) as AiDispatchBinding['scope'], id: admission.id, actorId: context.actorId,
        callId: request.callId, requestHash: hash, profileId: route.profile.id, dispatchId: randomUUID() };
      const token = structuredClone(binding);
      await life.wait(() => this.ports.dispatch.claim(structuredClone(token)).then(() => {
        if (closed) { void life.cleanup(() => this.ports.dispatch.finish(structuredClone(token), 'cancelled')).catch(() => {}); }
        else admissionId = admission.id;
      }));
      budgetCall = { context: structuredClone(context), binding: structuredClone(binding), expiresAt: life.expiresAt,
        request: { callId: request.callId, model: transportRequest.model, maxOutputTokens: request.maxOutputTokens, intentHash: intentBinding?.intentHash ?? hash,
          countRequestHash: this.ports.transport.inputBoundHash?.(structuredClone(transportRequest), structuredClone(route), false) } };
      const call = structuredClone(budgetCall);
      const usage = await life.wait(() => this.reserveBudget(call, life.controller.signal).then(record => {
        if (closed) { void life.cleanup(() => this.ports.budget.abandon(structuredClone(call), record.id, 'LATE_RESERVATION')).catch(() => {}); }
        else reservationId = record.id;
        return record;
      })); reservationId = usage.id;
      await life.wait(() => this.ports.audit.append({ callId: request.callId, ...this.attribution(context), event: 'ai.invoke.admitted', status: 'accepted' }));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      await life.wait(() => this.assertMediaCurrent(context, transportRequest, life.controller.signal));
      await life.wait(() => this.ports.budget.dispatch(structuredClone(call), usage.id));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      await life.wait(() => this.assertMediaCurrent(context, transportRequest, life.controller.signal));
      dispatched = true;
      const recordUsage = this.usageRecorder(call, usage.id);
      const transportStarted = performance.now();
      const rawResult = structuredClone(await life.wait(() => this.ports.transport.invoke(structuredClone(context), structuredClone(transportRequest), structuredClone(route), life.controller.signal, recordUsage, call.request.countRequestHash)
        .then(async value => {
          // Pin the returned payload before receipt persistence yields to its owner.
          const result = structuredClone(value);
          if (result.usage) await recordUsage(result.usage);
          return result;
        })));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      const result = intentBinding ? this.textResult(rawResult,
        intentBinding.structuredOutput === true && transportRequest.features?.includes('structuredOutput') === true,
        intentBinding.orderExplainTool === true && transportRequest.features?.includes('tools') === true) : rawResult;
      if (this.ports.observation) {
        await life.wait(() => this.ports.observation!.record(structuredClone({ call, reservationId: usage.id, route, result,
          timing: this.deliveryTiming(transportStarted),
          delivery: { mode: 'invoke' as const } })));
      }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      const reported = result.usage;
      if (reported) { await life.wait(() => this.ports.budget.settle(structuredClone(call), usage.id, `invoke:${request.callId}`, reported)); accounted = true; }
      else { await life.wait(() => this.ports.budget.abandon(structuredClone(call), usage.id, 'USAGE_UNAVAILABLE')); accounted = true; }
      await life.wait(() => this.ports.dispatch.finish(structuredClone(binding!), 'completed'));
      settled = true;
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      return { ...result, usageState: result.usage ? 'reported' : 'reconciliation_required' };
    } catch (error) {
      const failure = error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
      const terminalCommitted = settled;
      closed = true;
      settled = true;
      if (reservationId && !accounted) { const pendingId = reservationId; try { await life.cleanup(() => this.ports.budget.abandon(structuredClone(budgetCall!), pendingId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED')); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId && !terminalCommitted) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      throw failure;
    } finally {
      closed = true;
      life.close();
      if (!settled && (reservationId || admissionId)) {
        if (reservationId && !accounted) { const pendingId = reservationId; try { await life.cleanup(() => this.ports.budget.abandon(structuredClone(budgetCall!), pendingId, 'DISPATCH_UNKNOWN')); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      }
    }
  }

  async *stream(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): AsyncGenerator<GatewayStreamEvent> {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    yield* this.streamRequest(context, this.input(request), signal);
  }

  private async *streamRequest(context: GatewayContext, request: UnresolvedRequest | UnresolvedProtocolRequest, signal?: AbortSignal, intentBinding?: IntentExecutionBinding, intentLife?: GatewayDeadline): AsyncGenerator<GatewayStreamEvent> {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    this.assertBudget();
    request = structuredClone(request); context = structuredClone(context);
    const life = intentLife ?? this.deadline(signal);
    let scope!: AiProfileScope;
    let binding: AiDispatchBinding | undefined;
    let budgetCall: GatewayAccountingCall | undefined;
    let admissionId: string | undefined, reservationId: string | undefined, dispatched = false, accounted = false, settled = false, closed = false;
    let iterator: AsyncIterator<GatewayStreamEvent> | undefined;
    let sourceDone = false;
    let finalResult: GatewayInvocationResult | undefined;
    // Independent of provider token accounting: bounded transient delivery,
    // not a tokenizer, price estimator or a second task resource ledger.
    let eventCount = 0, deltaCount = 0, deltaBytes = 0;
    const deltaDigest = createHash('sha256');
    try {
      const resolution = structuredClone(await life.wait(() => this.ports.routing.resolve(context, this.required(request, true))));
      if (intentBinding && resolution.scene !== intentBinding.routeScene) throw new ModelGatewayError('CONFIG_INVALID');
      const route = resolution.route; scope = resolution.consumerScope;
      const parsedTransportRequest = modelProtocolRequestSchema.safeParse({ ...request, model: route.profile.model });
      if (!parsedTransportRequest.success) throw new ModelGatewayError('INVALID_REQUEST');
      const transportRequest = parsedTransportRequest.data;
      request = transportRequest;
      const hash = requestFingerprint({ request, routing: gatewayRoutingBinding(resolution), ...(intentBinding ? { intentBinding } : {}) });
      if (!this.ports.dispatch || typeof this.ports.dispatch.claim !== 'function' || typeof this.ports.dispatch.finish !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
      // Persist readiness before admission/claim/reserve. No presence-only gate.
      const preparation = { context: structuredClone(context), callId: request.callId,
        intentHash: intentBinding?.intentHash ?? hash, requestHash: hash,
        configurationHash: requestFingerprint(route.profile), profile: structuredClone(route.profile), mode: 'stream' as const };
      if (this.ports.audit.prepare) await life.wait(() => this.ports.audit.prepare!(preparation, life.controller.signal));
      else await life.wait(() => this.ports.audit.append({ callId: request.callId, ...this.attribution(context),
        event: 'ai.stream.prepared', status: 'prepared', detail: requestFingerprint(preparation) }));
      // An admission may be shared by concurrent attempts. Only a successful claim owns cleanup.
      const admission = await life.wait(() => this.ports.admission.admit({ scope: structuredClone(scope), actorId: context.actorId, callId: request.callId, requestHash: hash, profileId: route.profile.id, expiresAt: life.expiresAt }));
      binding = { scope: structuredClone(scope) as AiDispatchBinding['scope'], id: admission.id, actorId: context.actorId,
        callId: request.callId, requestHash: hash, profileId: route.profile.id, dispatchId: randomUUID() };
      const token = structuredClone(binding);
      await life.wait(() => this.ports.dispatch.claim(structuredClone(token)).then(() => {
        if (closed) { void life.cleanup(() => this.ports.dispatch.finish(structuredClone(token), 'cancelled')).catch(() => {}); }
        else admissionId = admission.id;
      }));
      budgetCall = { context: structuredClone(context), binding: structuredClone(binding), expiresAt: life.expiresAt,
        request: { callId: request.callId, model: transportRequest.model, maxOutputTokens: request.maxOutputTokens, intentHash: intentBinding?.intentHash ?? hash,
          countRequestHash: this.ports.transport.inputBoundHash?.(structuredClone(transportRequest), structuredClone(route), true) } };
      const call = structuredClone(budgetCall);
      const usage = await life.wait(() => this.reserveBudget(call, life.controller.signal).then(record => {
        if (closed) { void life.cleanup(() => this.ports.budget.abandon(structuredClone(call), record.id, 'LATE_RESERVATION')).catch(() => {}); }
        else reservationId = record.id;
        return record;
      })); reservationId = usage.id;
      await life.wait(() => this.ports.audit.append({ callId: request.callId, ...this.attribution(context), event: 'ai.stream.admitted', status: 'accepted' }));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      await life.wait(() => this.assertMediaCurrent(context, transportRequest, life.controller.signal));
      await life.wait(() => this.ports.budget.dispatch(structuredClone(call), usage.id));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      await life.wait(() => this.assertMediaCurrent(context, transportRequest, life.controller.signal));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      dispatched = true;
      const recordUsage = this.usageRecorder(call, usage.id);
      const transportStarted = performance.now();
      let firstText: number | null = null;
      let result: GatewayInvocationResult | undefined;
      iterator = this.ports.transport.stream(structuredClone(context), structuredClone(transportRequest), structuredClone(route), life.controller.signal, recordUsage, call.request.countRequestHash)[Symbol.asyncIterator]();
      while (true) {
        const item = await life.wait(() => iterator!.next().then(async value => {
          const item = structuredClone(value);
          if (!item.done && !result && item.value?.kind === 'result' && item.value.result?.usage) await recordUsage(item.value.result.usage);
          return item;
        }));
        if (item.done) { sourceDone = true; break; }
        if (++eventCount > 4094) throw new ModelGatewayError('INVALID_RESPONSE');
        const event = item.value;
        if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
        if (!event || result) throw new ModelGatewayError('INVALID_RESPONSE');
        if (event.kind === 'result') {
          if (!event.result || typeof event.result.text !== 'string' || event.result.text.length > 128000
            || Buffer.byteLength(event.result.text, 'utf8') > 512000) throw new ModelGatewayError('INVALID_RESPONSE');
          result = intentBinding ? this.textResult(event.result) : structuredClone(event.result);
        } else if (event.kind === 'text_delta' && typeof event.delta === 'string') {
          const delta = event.delta;
          if (delta.length > 128000 || (deltaBytes += Buffer.byteLength(delta, 'utf8')) > 512000) throw new ModelGatewayError('INVALID_RESPONSE');
          deltaCount++;
          deltaDigest.update(delta, 'utf8');
          await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
          if (delta.length && firstText === null) firstText = performance.now() - transportStarted;
          yield { kind: 'text_delta', delta };
        } else throw new ModelGatewayError('INVALID_RESPONSE');
      }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      if (!result) throw new ModelGatewayError('PROVIDER_FAILED');
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      if (this.ports.observation) {
        await life.wait(() => this.ports.observation!.record(structuredClone({ call, reservationId: usage.id, route, result,
          timing: this.deliveryTiming(transportStarted, firstText),
          delivery: { mode: 'stream' as const, eventCount, deltaCount, deltaBytes, deltaHash: deltaDigest.digest('hex') } })));
      }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      const reported = result.usage;
      if (reported) { await life.wait(() => this.ports.budget.settle(structuredClone(call), usage.id, `stream:${request.callId}`, reported)); accounted = true; }
      else { await life.wait(() => this.ports.budget.abandon(structuredClone(call), usage.id, 'USAGE_UNAVAILABLE')); accounted = true; }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      await life.wait(() => this.ports.dispatch.finish(structuredClone(binding!), 'completed'));
      settled = true;
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      finalResult = result;
    } catch (error) {
      const failure = error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
      const terminalCommitted = settled;
      closed = true;
      settled = true;
      if (reservationId && !accounted) { const pendingId = reservationId; try { await life.cleanup(() => this.ports.budget.abandon(structuredClone(budgetCall!), pendingId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED')); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId && !terminalCommitted) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      throw failure;
    } finally {
      life.controller.abort();
      closed = true;
      life.close();
      if (!settled) {
        if (reservationId && !accounted) { const pendingId = reservationId; try { await life.cleanup(() => this.ports.budget.abandon(structuredClone(budgetCall!), pendingId, 'CONSUMER_STOPPED')); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      }
      if (iterator?.return && !sourceDone) {
        try { await life.cleanup(() => iterator!.return!()); } catch { /* bounded abandonment; durable state remains pending */ }
      }
    }
    if (!finalResult) throw new ModelGatewayError('INVALID_RESPONSE');
    yield { kind: 'result', result: finalResult };
  }
}
