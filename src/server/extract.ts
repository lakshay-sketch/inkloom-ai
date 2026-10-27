import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "./auth";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 50_000;
const ALLOWED = [".txt", ".md", ".pdf", ".docx"];

/**
 * Extracts plain text from an uploaded file. The file is parsed as data only: never executed,
 * never written to disk. Type is checked by extension AND magic bytes; size is capped.
 */
export async function extractUploadedText(file: File): Promise<{ text: string; filename: string; truncated: boolean }> {
  const name = (file.name || "upload").slice(0, 200);
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED.includes(ext)) throw new HttpError(415, `Unsupported file type "${ext}". Use ${ALLOWED.join(", ")}.`);
  if (file.size === 0) throw new HttpError(400, "The file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    if (ext === ".pdf") {
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(415, "File does not look like a PDF");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else if (ext === ".docx") {
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new HttpError(415, "File does not look like a DOCX");
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else {
      if (buf.includes(0)) throw new HttpError(415, "File looks binary, not text");
      text = buf.toString("utf8");
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, "Could not read text from this file (it may be scanned, encrypted or corrupt). Scanned PDFs need OCR, which is not implemented.");
  }
  text = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (!text) throw new HttpError(422, "No text found in the file. Scanned PDFs need OCR, which is not implemented.");
  const truncated = text.length > MAX_TEXT_CHARS;
  return { text: text.slice(0, MAX_TEXT_CHARS), filename: name, truncated };
}
