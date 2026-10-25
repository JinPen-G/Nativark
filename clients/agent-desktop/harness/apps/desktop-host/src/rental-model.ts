/** Private shell inspection of an actual prepared model route. Never streams, forwards content or exposes credentials. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-llm'

/**
 * Inspect the initial route of a real adapter-bound call, with bounded lookup and no generation.
 * @param ctx - Running Host that owns the original LLM registry.
 * @param value - Closed provider/model selection from private shell control.
 * @returns Sanitized preparation metadata; missing/ambient/credential-dependent routes fail closed.
 */
export async function inspectRentalModel(ctx: Context, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['provider', 'model'].includes(key))
    || !('provider' in value) || typeof value.provider !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.provider)
    || !('model' in value) || typeof value.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u.test(value.model))
    throw new Error('AI_INVALID_INPUT')
  const selection = { provider: value.provider, model: value.model }, llm = ctx.get('llm')
  if (llm === undefined) throw new Error('AI_RESOURCE_UNAVAILABLE')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const prepared = await Promise.race([llm.prepareCall(selection, controller.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('AI_RESOURCE_UNAVAILABLE')) }, 4000)
    })])
    controller.signal.throwIfAborted()
    const route = prepared.destination
    if (!route || !['openai-responses', 'openai-completions', 'anthropic-messages'].includes(route.protocol)
      || route.baseUrl.length > 2048 || prepared.config.provider !== selection.provider || prepared.config.model !== selection.model)
      throw new Error('AI_RESOURCE_UNAVAILABLE')
    const url = new URL(route.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('AI_RESOURCE_UNAVAILABLE')
    const observedAt = new Date().toISOString()
    // Prepared facts only: not observation time, secrets, a database revision or dispatch authority.
    const preparationVersion = createHash('sha256').update(JSON.stringify({ config: prepared.config, context: prepared.context ?? null,
      inputModalities: prepared.inputModalities ?? null, retryPolicy: prepared.retryPolicy, systemPromptUpdate: prepared.systemPromptUpdate ?? null,
      toolUpdate: prepared.toolUpdate ?? null, protocol: route.protocol, baseUrl: url.href.replace(/\/+$/u, '') })).digest('hex')
    return { selection, destination: { provider: selection.provider, baseUrl: url.href.replace(/\/+$/u, '') }, protocol: route.protocol,
      preparationVersion, observedAt, expiresAt: new Date(Date.parse(observedAt) + 30000).toISOString(), source: 'prepared_initial_route', execution: 'not_dispatched' }
  } finally { clearTimeout(timer); controller.abort() }
}
