import "server-only";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import * as PDFKitModule from "pdfkit";
import {create} from "fontkit";
import {ReportArtifactUnavailableError, ReportInputError} from "./report-delivery-domain";

const FONT_SHA256 = "ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280";
// Both the application bundle and standalone worker use the same licensed asset.
function reportFont(): Readonly<{bytes:Buffer;path:string}> {
 let bytes: Buffer;
 let path: string;
 try {
  bytes=readFileSync(resolve(__dirname,"fonts/DejaVuSans.ttf"));
  path=resolve(__dirname,"fonts/DejaVuSans.ttf");
 } catch(error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ReportArtifactUnavailableError();
  try {
   bytes=readFileSync(resolve(process.cwd(),"src/lib/reports/fonts/DejaVuSans.ttf"));
   path=resolve(process.cwd(),"src/lib/reports/fonts/DejaVuSans.ttf");
  } catch {
   throw new ReportArtifactUnavailableError();
  }
 }
 if (createHash("sha256").update(bytes).digest("hex") !== FONT_SHA256) throw new ReportArtifactUnavailableError();
 return {bytes,path};
}

export type ReportPdfInput = Readonly<{
 reportId: string; title: string; requestedAt: string; kind?: "credential";
 headers: readonly string[]; rows: readonly Readonly<Record<string,string>>[];
}>;

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
 if (!input || typeof input.reportId !== "string" || typeof input.title !== "string" ||
     typeof input.requestedAt !== "string" || !Number.isFinite(Date.parse(input.requestedAt)) ||
     (input.kind !== undefined && input.kind !== "credential") ||
     !Array.isArray(input.headers) || input.headers.length === 0 ||
     input.headers.some(header=>typeof header !== "string" || header.length === 0) ||
     !Array.isArray(input.rows) || input.rows.some(row=>!row || input.headers.some(header=>typeof row[header] !== "string"))) {
  throw new ReportInputError();
 }
 const bundled=reportFont();
 const font=create(bundled.bytes);
 if (!("hasGlyphForCodePoint" in font)) throw new ReportArtifactUnavailableError();
 let substituted=false;
 const text=(value:string):string=>Array.from(value).map(character=>{
  const point=character.codePointAt(0)!;
  if (character === "\n" || character === "\t" || font.hasGlyphForCodePoint(point)) return character;
  substituted=true;
  return "[U+"+point.toString(16).toUpperCase().padStart(4,"0")+"]";
 }).join("");
 // Namespace interop supports the project runtime and its CommonJS test/worker loaders.
 const PDFDocument=(PDFKitModule as unknown as {default?:typeof import("pdfkit")}).default ??
  (PDFKitModule as unknown as typeof import("pdfkit"));
 const document=new PDFDocument({pdfVersion:"1.4",size:"A4",margin:40,font:bundled.path,info:{Title:input.title,Author:"HSE Verify",CreationDate:new Date(input.requestedAt),ModDate:new Date(input.requestedAt)}});
 const chunks:Buffer[]=[];
 const output=new Promise<Uint8Array>((resolveOutput,reject)=>{
  document.on("data",(chunk:Uint8Array)=>chunks.push(Buffer.from(chunk)));
  document.on("error",()=>reject(new ReportArtifactUnavailableError()));
  document.on("end",()=>resolveOutput(Buffer.concat(chunks)));
 });
 try {
  document.fontSize(18).text(text(input.title));
  document.moveDown(0.5).fontSize(9).text(text((input.kind === "credential" ? "Credential: " : "Report: ")+input.reportId));
  if (input.kind !== "credential") document.text(text("Requested at: "+input.requestedAt));
  document.moveDown();
  if (input.rows.length === 0) document.fontSize(11).text("No records match this report.");
  input.rows.forEach((row,index)=>{
   if (input.kind !== "credential") document.fontSize(11).text("Record "+(index+1));
   for (const header of input.headers) document.fontSize(9).text(text(header)+": "+text(row[header]),{lineGap:2});
   document.moveDown();
  });
  if (substituted) document.fontSize(9).text(input.kind === "credential"
   ? "Unsupported characters are shown as Unicode code points (U+...). The public verification page retains the original text."
   : "Unsupported characters are shown as Unicode code points (U+...). CSV and print exports retain the original text.");
  document.end();
 } catch {
  document.destroy(new ReportArtifactUnavailableError());
 }
 return output;
}
