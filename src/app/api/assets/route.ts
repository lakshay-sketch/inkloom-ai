import { z } from "zod";
import { route, json } from "@/server/http";
import { createAsset, listAssets, runCheck } from "@/server/content";

// These routes may call the LLM (25 s ceiling) after several database round trips.
export const maxDuration = 60;

export const GET = route(async ({ brandId }) => ({ assets: await listAssets(brandId) }));
export const POST = route(async ({ req, actor, brandId }) => {
  const v = z.object({ title: z.string(), body: z.string(), check: z.boolean().default(true) }).parse(await json(req));
  const asset = await createAsset(brandId, actor, v); // saved first so the text is never lost if checking fails
  const result = v.check ? await runCheck(brandId, actor, asset.id) : null;
  return { asset, run: result?.run ?? null };
}, 201);
