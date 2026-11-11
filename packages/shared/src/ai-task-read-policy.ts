/** Closed three-policy read enablement. Manager configuration and ordinary
 * original-resource authorization use separate routes and reference bindings.
 * No caller permissions, scope, Core grant, lease or execution is accepted. */
import { z } from 'zod';
export const AI_TASK_READ_POLICY_VERSION = 'ain-task-read-policy-1' as const;
export const AI_TASK_READ_POLICY_HTTP = { basePath: 'ai-native/task-read-policy', inspect: 'inspect', enable: 'enable', operation: 'operation' } as const;
export const AI_TASK_ORIGINAL_READ_POLICY_HTTP = { basePath: 'ai-native/original-task-read-policies',
  inspect: 'inspect', enable: 'enable', operation: 'operation' } as const;
/** Entry alternatives from the original order/settings/readiness GET routes.
 * The application still verifies the specific current resource and owner. */
export const AI_TASK_ORIGINAL_READ_POLICY_ENTRY_PERMISSIONS = ['rental-os:order:view', 'rental-os:order:create',
  'rental-os:rules:manage', 'rental-os:price:manage', 'system:user:manage', 'system:role:manage'] as const;
export const AI_TASK_READ_POLICY_OPERATIONS = ['read_metadata','read_events','read_step_terminal'] as const;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.string().max(40).datetime({ offset: true }), revision = z.number().int().min(1).max(4294967293);
const operation = z.enum(AI_TASK_READ_POLICY_OPERATIONS), permissions = z.array(z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)).min(1).max(64);
export const aiTaskReadPolicyQuery = z.object({ taskId: id, runId: id.optional() }).strict();
const expected = z.object({ read_metadata: revision.nullable(), read_events: revision.nullable(), read_step_terminal: revision.nullable() }).strict();
export const aiTaskReadPolicyReference = z.object({ taskId: id, runId: id, expiresAt: time, expected, reviewHash: hash }).strict();
export const aiTaskReadPolicyEnable = aiTaskReadPolicyReference.extend({ decision: z.literal('enable_original_task_reading') }).strict();
const policy = z.object({ taskId: id, operation, revision: z.number().int().min(1).max(4294967294), requiredPermissions: permissions, expiresAt: time }).strict();
export const aiTaskReadPolicyResponse = z.object({ contractVersion: z.literal(AI_TASK_READ_POLICY_VERSION), phase: z.enum(['review','operation']),
  reference: aiTaskReadPolicyReference, scope: z.object({ kind: z.literal('workspace'), tenantId: z.string().min(1).max(191), workspaceId: z.string().min(1).max(191) }).strict(),
  observedAt: time, completeRecorded: z.boolean(), items: z.array(z.object({ operation, current: policy.nullable(), active: z.boolean(),
    desired: z.object({ requiredPermissions: permissions, expiresAt: time }).strict(),
    receipt: z.object({ state: z.enum(['not_checked','not_observed','recorded']), policy: policy.nullable() }).strict() }).strict()).length(3),
  execution: z.literal('not_attempted'), authority: z.literal('reading_policy_not_model_or_core_authorization') }).strict().superRefine((v,c) => {
    if (v.items.some((row,i) => row.operation !== AI_TASK_READ_POLICY_OPERATIONS[i]
      || row.current !== null && (row.current.taskId !== v.reference.taskId || row.current.operation !== row.operation)
      || row.receipt.policy !== null && (row.receipt.policy.taskId !== v.reference.taskId || row.receipt.policy.operation !== row.operation))) c.addIssue({ code:'custom',message:'Policy reference mismatch' });
  });
export type AiTaskReadPolicyQuery = z.infer<typeof aiTaskReadPolicyQuery>;
export type AiTaskReadPolicyReference = z.infer<typeof aiTaskReadPolicyReference>;
export type AiTaskReadPolicyEnable = z.infer<typeof aiTaskReadPolicyEnable>;
export type AiTaskReadPolicyResponse = z.infer<typeof aiTaskReadPolicyResponse>;
type JsonSchema = { type?: string; format?: string; pattern?: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number;
  properties?: Record<string,JsonSchema>; required?: string[]; additionalProperties?: boolean; enum?: (string|boolean)[]; oneOf?: JsonSchema[]; items?: JsonSchema; minItems?:number; maxItems?:number };
const object = (properties: Record<string,JsonSchema>, required=Object.keys(properties)):JsonSchema => ({type:'object',properties,required,additionalProperties:false});
const literal = (v:string|boolean):JsonSchema => ({type:typeof v,enum:[v]}), array=(items:JsonSchema,maxItems:number,minItems=0):JsonSchema => ({type:'array',items,minItems,maxItems});
const atom:JsonSchema={type:'string',minLength:1,maxLength:36,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]*$'}, timestamp:JsonSchema={type:'string',format:'date-time',maxLength:40};
const op:JsonSchema={type:'string',enum:[...AI_TASK_READ_POLICY_OPERATIONS]}, permission=array({...atom,maxLength:191},64,1), rev:JsonSchema={type:'integer',minimum:1,maximum:4294967293};
const nullable=(value:JsonSchema):JsonSchema=>({oneOf:[value,{type:'null'}]}), expectedSchema=object(Object.fromEntries(AI_TASK_READ_POLICY_OPERATIONS.map(k=>[k,nullable(rev)])));
const refFields={taskId:atom,runId:atom,expiresAt:timestamp,expected:expectedSchema,reviewHash:{type:'string',pattern:'^[a-f0-9]{64}$'}};
const policySchema=object({taskId:atom,operation:op,revision:{...rev,maximum:4294967294},requiredPermissions:permission,expiresAt:timestamp});
export const AI_TASK_READ_POLICY_SCHEMAS={
  AiTaskReadPolicyQuery:object({taskId:atom,runId:atom},['taskId']), AiTaskReadPolicyReference:object(refFields),
  AiTaskReadPolicyEnable:object({...refFields,decision:literal('enable_original_task_reading')}),
  AiTaskReadPolicyResponse:object({contractVersion:literal(AI_TASK_READ_POLICY_VERSION),phase:{type:'string',enum:['review','operation']},reference:object(refFields),
    scope:object({kind:literal('workspace'),tenantId:{...atom,maxLength:191},workspaceId:{...atom,maxLength:191}}),observedAt:timestamp,completeRecorded:{type:'boolean'},
    items:array(object({operation:op,current:nullable(policySchema),active:{type:'boolean'},desired:object({requiredPermissions:permission,expiresAt:timestamp}),
      receipt:object({state:{type:'string',enum:['not_checked','not_observed','recorded']},policy:nullable(policySchema)})}),3,3),
    execution:literal('not_attempted'),authority:literal('reading_policy_not_model_or_core_authorization')})
} as const;
