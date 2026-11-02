export class ReviewQualityInputError extends Error {}
export type ReviewQualityPolicy = Readonly<{requireSecond:boolean;samplingPercent:number}>;
export function reviewQualityPolicy(values:Readonly<Record<string,unknown>>):ReviewQualityPolicy {
 const required=values.evidence_second_review_required;
 const sampling=values.evidence_review_sampling_percent;
 if(required!==undefined&&typeof required!=="boolean")throw new ReviewQualityInputError("Evidence second-review requirement must be a boolean.");
 if(sampling!==undefined&&(typeof sampling!=="number"||!Number.isInteger(sampling)||sampling<0||sampling>100))throw new ReviewQualityInputError("Evidence review sampling must be an integer percentage between 0 and 100.");
 return Object.freeze({requireSecond:required===true,samplingPercent:typeof sampling==="number"?sampling:0});
}
