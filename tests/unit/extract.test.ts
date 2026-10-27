import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractUploadedText, MAX_UPLOAD_BYTES } from "@/server/extract";
import { HttpError } from "@/server/auth";

const fx = (n: string, type = "") => new File([fs.readFileSync(path.join(__dirname, "../fixtures", n))], n, { type });
const status = async (f: File) => { try { await extractUploadedText(f); } catch (e) { return (e as HttpError).status; } return 0; };

describe("upload extraction", () => {
  it("reads txt", async () => expect((await extractUploadedText(new File(["Hello guideline text"], "a.txt"))).text).toBe("Hello guideline text"));
  it("reads docx", async () => expect((await extractUploadedText(fx("guideline.docx"))).text).toContain('Never use the word "revolutionary"'));
  it("reads pdf", async () => expect((await extractUploadedText(fx("guideline.pdf"))).text).toContain("Avoid exaggerated superlatives"));
  it("rejects unsupported extensions", async () => expect(await status(new File(["x"], "evil.exe"))).toBe(415));
  it("rejects a renamed non-pdf / non-docx", async () => {
    expect(await status(new File(["not a pdf"], "a.pdf"))).toBe(415);
    expect(await status(new File(["not a zip"], "a.docx"))).toBe(415);
  });
  it("rejects binary content named .txt", async () => expect(await status(new File([new Uint8Array([1, 0, 2, 0])], "a.txt"))).toBe(415));
  it("rejects empty and oversized files", async () => {
    expect(await status(new File([], "a.txt"))).toBe(400);
    expect(await status(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(65)], "big.txt"))).toBe(413);
  });
  it("reports a corrupt pdf as unreadable instead of crashing", async () => expect(await status(new File(["%PDF-1.4 garbage"], "bad.pdf"))).toBe(422));
});
