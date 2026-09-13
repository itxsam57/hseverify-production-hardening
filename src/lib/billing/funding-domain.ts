import { createIdentifier } from "../auth/auth-domain";

export type FundingStatus = "REQUESTED"|"APPROVED"|"REJECTED"|"CANCELLED";
export type FundingRequest = Readonly<{fundingRequestId:string;workerLinkId:string;status:FundingStatus;creditUnits:number;reservedCreditUnits:number;createdAt:string;updatedAt:string}>;
export class FundingError extends Error {}
export class FundingConflictError extends FundingError {}
export function fundingId():string { return createIdentifier("funding"); }
export function positiveCredits(value:number):number { if(!Number.isSafeInteger(value)||value<=0) throw new FundingError("Credits must be positive."); return value; }
