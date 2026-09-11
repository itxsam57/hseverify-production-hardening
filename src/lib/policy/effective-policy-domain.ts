import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";

export const POLICY_PLATFORM_PERMISSION="platform.operations.manage" as const;
export const POLICY_TENANT_PERMISSION="company.settings.manage" as const;
export type PolicyAdminPrincipal=AuthorizationPrincipal;
export type PolicyTenantPrincipal=TenantPermissionPrincipal<typeof POLICY_TENANT_PERMISSION>;
export const OVERRIDE_DIRECTIONS=["MINIMUM","MAXIMUM","BOOLEAN_ENABLE","BOOLEAN_DISABLE"] as const;
export type OverrideDirection=(typeof OVERRIDE_DIRECTIONS)[number];
export type PolicyObject=Readonly<Record<string,unknown>>;
export type EffectivePolicySnapshot=Readonly<{snapshotId:string;caseId:string;tenantId:string;frameworkId:string;policyId:string;globalPolicyVersionId:string;tenantOverrideId:string|null;policySource:"GLOBAL"|"GLOBAL_PLUS_TENANT_OVERRIDE";effectiveValue:PolicyObject;referenceTime:string;resolvedAt:string}>;
export type EffectivePolicyResolution=Readonly<{frameworkId:string;policyId:string;globalPolicyVersionId:string;tenantOverrideId:string|null;policySource:"GLOBAL"|"GLOBAL_PLUS_TENANT_OVERRIDE";effectiveValue:PolicyObject}>;
export class EffectivePolicyInputError extends Error{constructor(message="Effective policy input is invalid."){super(message);this.name="EffectivePolicyInputError";}}
export class EffectivePolicyAccessError extends Error{constructor(){super("The effective policy could not be accessed.");this.name="EffectivePolicyAccessError";}}
export class EffectivePolicyConflictError extends Error{constructor(message="Effective policy resolution is ambiguous or unavailable."){super(message);this.name="EffectivePolicyConflictError";}}
export const createFrameworkId=()=>createIdentifier("framework");
export const createPolicyId=()=>createIdentifier("policy");
export const createPolicyVersionId=()=>createIdentifier("policy_version");
export const createPolicyOverrideId=()=>createIdentifier("policy_override");
export const createPolicySnapshotId=()=>createIdentifier("policy_snapshot");
export function normalizePolicyReference(value:string,label="reference"):string{const v=value.trim();if(v.length<2||v.length>120||!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(v))throw new EffectivePolicyInputError(`${label} is invalid.`);return v;}
export function normalizePolicyTitle(value:string):string{const v=value.trim().replace(/\s+/g," ");if(v.length<2||v.length>200)throw new EffectivePolicyInputError("Policy title is invalid.");return v;}
export function normalizePolicyObject(value:unknown,label="policy"):PolicyObject{if(!value||typeof value!=="object"||Array.isArray(value))throw new EffectivePolicyInputError(`${label} must be a JSON object.`);const encoded=JSON.stringify(value);if(encoded.length>32768)throw new EffectivePolicyInputError(`${label} exceeds 32 KB.`);const parsed=JSON.parse(encoded) as Record<string,unknown>;return Object.freeze(parsed);}
export function normalizeAllowedFields(value:readonly string[]):readonly string[]{const fields=[...new Set(value.map(v=>v.trim()).filter(Boolean))];if(fields.length>64||fields.some(v=>v.length>120||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(v)))throw new EffectivePolicyInputError("Override fields are invalid.");return Object.freeze(fields.sort());}
export function normalizeDirections(value:Record<string,string>,allowed:readonly string[],globalValues:PolicyObject):Readonly<Record<string,OverrideDirection>>{const out:Record<string,OverrideDirection>={};for(const field of allowed){const direction=value[field];if(!OVERRIDE_DIRECTIONS.includes(direction as OverrideDirection)||!(field in globalValues))throw new EffectivePolicyInputError(`Override direction for ${field} is invalid.`);out[field]=direction as OverrideDirection;}if(Object.keys(value).some(k=>!allowed.includes(k)))throw new EffectivePolicyInputError("Override directions include a disallowed field.");return Object.freeze(out);}
export function assertTighteningOverride(globalValues:PolicyObject,allowed:readonly string[],directions:Readonly<Record<string,OverrideDirection>>,overrideValues:PolicyObject):void{for(const [field,next] of Object.entries(overrideValues)){if(!allowed.includes(field))throw new EffectivePolicyConflictError(`Override field ${field} is not allowed.`);const base=globalValues[field],direction=directions[field];if(!direction)throw new EffectivePolicyConflictError(`Override field ${field} has no tightening rule.`);if(direction==="MINIMUM"){if(typeof base!=="number"||typeof next!=="number"||next<base)throw new EffectivePolicyConflictError(`Override field ${field} weakens the global minimum.`);}else if(direction==="MAXIMUM"){if(typeof base!=="number"||typeof next!=="number"||next>base)throw new EffectivePolicyConflictError(`Override field ${field} weakens the global maximum.`);}else if(direction==="BOOLEAN_ENABLE"){if(typeof base!=="boolean"||typeof next!=="boolean"||(base===true&&next===false))throw new EffectivePolicyConflictError(`Override field ${field} disables a required control.`);}else if(direction==="BOOLEAN_DISABLE"){if(typeof base!=="boolean"||typeof next!=="boolean"||(base===false&&next===true))throw new EffectivePolicyConflictError(`Override field ${field} enables a prohibited control.`);}}
}
export function mergePolicy(globalValues:PolicyObject,overrideValues:PolicyObject):PolicyObject{return Object.freeze({...globalValues,...overrideValues});}
