import { route } from "@/server/http";
import { extractUploadedText } from "@/server/extract";
import { HttpError } from "@/server/auth";

export const POST = route(async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a file in the 'file' field");
  return await extractUploadedText(file);
});
