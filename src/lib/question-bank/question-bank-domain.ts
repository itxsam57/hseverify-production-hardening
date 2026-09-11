import { createHash } from "node:crypto";
import { createIdentifier } from "../auth/auth-domain";

export const QUESTION_TYPES=["MULTIPLE_CHOICE","TRUE_FALSE","SHORT_TEXT","LONG_TEXT","INTEGER","DECIMAL"] as const;
export type QuestionType=(typeof QUESTION_TYPES)[number];
export const QUESTION_DIFFICULTIES=["EASY","MEDIUM","HARD"] as const;
export type QuestionDifficulty=(typeof QUESTION_DIFFICULTIES)[number];
export const QUESTION_STATUSES=["ACTIVE","INACTIVE"] as const;
export type QuestionStatus=(typeof QUESTION_STATUSES)[number];
export type RubricCriterion=Readonly<{description:string;points:number}>;
export type WrittenRubric=Readonly<{maxScore:number;criteria:readonly RubricCriterion[]}>;
export type QuestionAnswerKey=string|boolean|number|null;

export type QuestionVersionInput=Readonly<{
  questionType:QuestionType;
  prompt:string;
  options?:readonly string[]|null;
  answerKey?:unknown;
  rubric?:unknown;
  frameworkReference:string;
  domainReference:string;
  difficulty:QuestionDifficulty;
  tags?:readonly string[];
}>;
export type NormalizedQuestionVersion=Readonly<{
  questionType:QuestionType;prompt:string;options:readonly string[]|null;answerKey:QuestionAnswerKey;rubric:WrittenRubric|null;
  frameworkReference:string;domainReference:string;difficulty:QuestionDifficulty;tags:readonly string[];contentFingerprint:string;
}>;
export type StoredQuestion=Readonly<{questionId:string;questionReference:string;questionStatus:QuestionStatus;currentVersionId:string;currentContentFingerprint:string;createdAt:string;updatedAt:string}>;
export type StoredQuestionVersion=Readonly<{questionVersionId:string;questionId:string;versionNo:number;questionType:QuestionType;prompt:string;options:readonly string[]|null;answerKey:QuestionAnswerKey;rubric:WrittenRubric|null;frameworkId:string;domainReference:string;difficulty:QuestionDifficulty;tags:readonly string[];contentFingerprint:string;createdAt:string}>;

export class QuestionBankInputError extends Error{constructor(message="Question input is invalid."){super(message);this.name="QuestionBankInputError";}}
export class QuestionBankAccessError extends Error{constructor(){super("The question could not be accessed.");this.name="QuestionBankAccessError";}}
export class QuestionBankConflictError extends Error{constructor(message="Question state changed or conflicts with an existing question."){super(message);this.name="QuestionBankConflictError";}}

export const createQuestionId=()=>createIdentifier("assessment_question");
export const createQuestionVersionId=()=>createIdentifier("question_version");
export function normalizeQuestionReference(value:string):string{const v=value.trim().toUpperCase();if(v.length<2||v.length>120||!/^[A-Z0-9][A-Z0-9._:/-]*$/.test(v))throw new QuestionBankInputError("Question reference is invalid.");return v;}
export function normalizePrompt(value:string):string{const v=value.trim().replace(/\s+/g," ");if(v.length<10||v.length>5000)throw new QuestionBankInputError("Question prompt must contain 10 to 5,000 characters.");return v;}
export function normalizeDomainReference(value:string):string{const v=value.trim().replace(/\s+/g," ");if(v.length<2||v.length>160)throw new QuestionBankInputError("Question domain is invalid.");return v;}
export function normalizeTags(values:readonly string[]|undefined):readonly string[]{const tags=[...new Set((values??[]).map(v=>v.trim().toLowerCase()).filter(Boolean))].sort();if(tags.length>24||tags.some(v=>v.length>60||!/^[a-z0-9][a-z0-9 _./:-]*$/.test(v)))throw new QuestionBankInputError("Question tags are invalid.");return Object.freeze(tags);}
export function normalizeMultipleChoice(options:readonly string[]|null|undefined,answerKey:unknown):Readonly<{options:readonly string[];answerKey:string}>{const normalized=(options??[]).map(v=>v.trim().replace(/\s+/g," ")).filter(Boolean);if(normalized.length<2||normalized.length>12)throw new QuestionBankInputError("Multiple choice questions require 2 to 12 options.");if(new Set(normalized.map(v=>v.toLocaleLowerCase())).size!==normalized.length)throw new QuestionBankInputError("Multiple choice options must be unique.");if(typeof answerKey!=="string")throw new QuestionBankInputError("Multiple choice answer key must name one option.");const answer=answerKey.trim().replace(/\s+/g," ");if(!normalized.includes(answer))throw new QuestionBankInputError("Multiple choice answer key must exactly match one option.");return Object.freeze({options:Object.freeze(normalized),answerKey:answer});}
export function normalizeTrueFalse(answerKey:unknown):boolean{if(typeof answerKey!=="boolean")throw new QuestionBankInputError("True/false answer key must be boolean.");return answerKey;}
export function normalizeInteger(answerKey:unknown):number{if(typeof answerKey!=="number"||!Number.isFinite(answerKey)||!Number.isInteger(answerKey))throw new QuestionBankInputError("Integer answer key must be a finite integer.");return answerKey;}
export function normalizeDecimal(answerKey:unknown):number{if(typeof answerKey!=="number"||!Number.isFinite(answerKey))throw new QuestionBankInputError("Decimal answer key must be a finite number.");return answerKey;}
export function normalizeWrittenRubric(value:unknown):WrittenRubric{if(!value||typeof value!=="object"||Array.isArray(value))throw new QuestionBankInputError("Written questions require a structured rubric.");const raw=value as {maxScore?:unknown;criteria?:unknown};if(typeof raw.maxScore!=="number"||!Number.isFinite(raw.maxScore)||raw.maxScore<=0||raw.maxScore>1000)throw new QuestionBankInputError("Rubric maxScore is invalid.");if(!Array.isArray(raw.criteria)||raw.criteria.length<1||raw.criteria.length>20)throw new QuestionBankInputError("Rubric requires 1 to 20 criteria.");const criteria=raw.criteria.map((item,index)=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new QuestionBankInputError(`Rubric criterion ${index+1} is invalid.`);const row=item as {description?:unknown;points?:unknown};const description=typeof row.description==="string"?row.description.trim().replace(/\s+/g," "):"";if(description.length<3||description.length>500)throw new QuestionBankInputError(`Rubric criterion ${index+1} description is invalid.`);if(typeof row.points!=="number"||!Number.isFinite(row.points)||row.points<=0)throw new QuestionBankInputError(`Rubric criterion ${index+1} points are invalid.`);return Object.freeze({description,points:row.points});});const total=criteria.reduce((sum,row)=>sum+row.points,0);if(Math.abs(total-raw.maxScore)>1e-9)throw new QuestionBankInputError("Rubric criterion points must total maxScore.");return Object.freeze({maxScore:raw.maxScore,criteria:Object.freeze(criteria)});}
function semanticFingerprint(input:{questionType:QuestionType;prompt:string;options:readonly string[]|null}):string{const options=input.options?[...input.options].map(v=>v.toLocaleLowerCase()).sort():null;return createHash("sha256").update(JSON.stringify({type:input.questionType,prompt:input.prompt.toLocaleLowerCase(),options})).digest("hex");}
export function normalizeQuestionVersion(input:QuestionVersionInput):NormalizedQuestionVersion{if(!QUESTION_TYPES.includes(input.questionType))throw new QuestionBankInputError("Question type is unsupported.");if(!QUESTION_DIFFICULTIES.includes(input.difficulty))throw new QuestionBankInputError("Question difficulty is invalid.");const prompt=normalizePrompt(input.prompt),frameworkReference=input.frameworkReference.trim(),domainReference=normalizeDomainReference(input.domainReference),tags=normalizeTags(input.tags);if(frameworkReference.length<2||frameworkReference.length>120)throw new QuestionBankInputError("Framework reference is invalid.");let options:readonly string[]|null=null,answerKey:QuestionAnswerKey=null,rubric:WrittenRubric|null=null;if(input.questionType==="MULTIPLE_CHOICE"){const normalized=normalizeMultipleChoice(input.options,input.answerKey);options=normalized.options;answerKey=normalized.answerKey;}else if(input.questionType==="TRUE_FALSE")answerKey=normalizeTrueFalse(input.answerKey);else if(input.questionType==="INTEGER")answerKey=normalizeInteger(input.answerKey);else if(input.questionType==="DECIMAL")answerKey=normalizeDecimal(input.answerKey);else rubric=normalizeWrittenRubric(input.rubric);return Object.freeze({questionType:input.questionType,prompt,options,answerKey,rubric,frameworkReference,domainReference,difficulty:input.difficulty,tags,contentFingerprint:semanticFingerprint({questionType:input.questionType,prompt,options})});}
