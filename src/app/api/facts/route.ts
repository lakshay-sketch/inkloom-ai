import { route, json } from "@/server/http";
import { createFact, listFacts } from "@/server/knowledge";

export const GET = route(async ({ brandId }) => ({ facts: await listFacts(brandId) }));
export const POST = route(async ({ req, actor, brandId }) => ({ fact: await createFact(brandId, actor, (await json(req)) as never) }), 201);
