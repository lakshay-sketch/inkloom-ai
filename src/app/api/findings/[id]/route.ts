import { route, json } from "@/server/http";
import { applyFinding } from "@/server/content";

export const POST = route<{ id: string }>(async ({ req, actor, brandId, params }) => ({ asset: await applyFinding(brandId, actor, params.id, (await json(req)) as never) }));
