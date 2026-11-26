/** Registered protocol shape and output validation. A tool parser is an
 * optional server contribution; decoding a request never executes a tool. */
import Ajv, { type ValidateFunction } from 'ajv';
import { ModelGatewayError, type AdapterResult, type ModelFeature, type ProtocolToolCall, type ModelResponsePolicy } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

export interface StructuredProtocolOptions { structuredOutput?: { name: string; schema: Readonly<Record<string, unknown>> } }
export interface ProtocolToolContract<Tool> {
  name: string;
  parameters: Readonly<Record<string, unknown>>;
  nativeResult: boolean;
  parse(input: unknown): Tool;
}
const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function boundedSchema(value: unknown, depth = 0, count = { value: 0 }): void {
  if (++count.value > 256 || depth > 12 || !value || typeof value !== 'object' || Array.isArray(value)) throw new ModelGatewayError('CONFIG_INVALID');
  const schema = value as Record<string, unknown>;
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'description']);
  if (Object.keys(schema).some(key => !allowed.has(key)) || !['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(String(schema.type))) throw new ModelGatewayError('CONFIG_INVALID');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) throw new ModelGatewayError('CONFIG_INVALID');
    for (const child of Object.values(schema.properties)) boundedSchema(child, depth + 1, count);
  }
  if (schema.type === 'array') {
    if (!Number.isSafeInteger(schema.maxItems) || Number(schema.maxItems) < 0 || Number(schema.maxItems) > 256) throw new ModelGatewayError('CONFIG_INVALID');
    boundedSchema(schema.items, depth + 1, count);
  }
  if (schema.type === 'string' && (!Number.isSafeInteger(schema.maxLength) || Number(schema.maxLength) < 0 || Number(schema.maxLength) > 16000)) throw new ModelGatewayError('CONFIG_INVALID');
}

export class ModelProtocolPolicy<Tool = never> implements ModelResponsePolicy<Tool> {
  readonly tools: boolean;
  readonly structured: boolean;
  readonly structuredSchemaHash?: string;
  private readonly tool?: ProtocolToolContract<Tool>;
  private readonly output?: StructuredProtocolOptions['structuredOutput'];
  private readonly validateOutput?: ValidateFunction;

  constructor(options: StructuredProtocolOptions = {}, tool?: ProtocolToolContract<Tool>) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'structuredOutput'))
      throw new ModelGatewayError('CONFIG_INVALID');
    try {
      this.output = options.structuredOutput && structuredClone(options.structuredOutput);
      this.tool = tool && { ...tool, parameters: structuredClone(tool.parameters) };
    } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    this.tools = this.tool !== undefined;
    this.structured = this.output !== undefined;
    if (this.output) {
      let encoded: string | undefined;
      try { encoded = JSON.stringify(this.output.schema); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      if (!encoded || !name.test(this.output.name) || Object.keys(this.output).some(key => !['name', 'schema'].includes(key)) || Buffer.byteLength(encoded) > 32768)
        throw new ModelGatewayError('CONFIG_INVALID');
      boundedSchema(this.output.schema);
      const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
      try { this.validateOutput = ajv.compile(this.output.schema); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      // Keep the original hash namespace so persisted structured requests stay valid.
      this.structuredSchemaHash = requestFingerprint({ version: 'rental-response-schema-1', name: this.output.name,
        schema: this.output.schema, strict: true });
    }
  }

  get nativeToolResults(): boolean { return this.tool?.nativeResult === true; }

  body(features: readonly ModelFeature[]): Record<string, unknown> {
    if (features.includes('tools') && !this.tools || features.includes('structuredOutput') && !this.structured
      || features.includes('tools') && features.includes('structuredOutput')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return {
      ...(features.includes('tools') ? { tools: [{ type: 'function', function: { name: this.tool!.name,
        parameters: structuredClone(this.tool!.parameters), strict: true } }], parallel_tool_calls: false } : {}),
      ...(features.includes('structuredOutput') ? { response_format: { type: 'json_schema', json_schema: { name: this.output!.name,
        schema: structuredClone(this.output!.schema), strict: true } } } : {})
    };
  }

  parse(text: string, calls: readonly ProtocolToolCall[]): Pick<AdapterResult<Tool>, 'toolRequests' | 'structuredOutput'> {
    if (calls.length) {
      const tool = this.tool;
      if (!tool || calls.length > 8) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      const ids = new Set<string>();
      return { toolRequests: calls.map(call => {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(call.id) || ids.has(call.id) || call.type !== 'function' || call.function.name !== tool.name
          || typeof call.function.arguments !== 'string' || call.function.arguments.length > 16000) throw new ModelGatewayError('INVALID_RESPONSE');
        ids.add(call.id);
        try { return tool.parse(JSON.parse(call.function.arguments)); }
        catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
      }) };
    }
    if (this.output) {
      let structuredOutput: unknown;
      try { structuredOutput = JSON.parse(text); } catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
      if (!this.validateOutput!(structuredOutput)) throw new ModelGatewayError('INVALID_RESPONSE');
      return { structuredOutput };
    }
    return {};
  }

  selected(features: readonly ModelFeature[]): ModelProtocolPolicy<Tool> {
    this.body(features);
    return new ModelProtocolPolicy(features.includes('structuredOutput') ? { structuredOutput: this.output } : {},
      features.includes('tools') ? this.tool : undefined);
  }
}
