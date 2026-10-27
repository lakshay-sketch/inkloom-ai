import { route, json } from "@/server/http";
import { addGuideline } from "@/server/knowledge";

export const POST = route(async ({ req, actor, brandId }) => ({ guideline: await addGuideline(brandId, actor, (await json(req)) as never) }), 201);
