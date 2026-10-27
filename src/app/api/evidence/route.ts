import { route, json } from "@/server/http";
import { addEvidence } from "@/server/knowledge";

export const POST = route(async ({ req, actor, brandId }) => ({ evidence: await addEvidence(brandId, actor, (await json(req)) as never) }), 201);
