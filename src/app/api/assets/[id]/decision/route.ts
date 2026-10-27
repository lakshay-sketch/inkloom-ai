import { route, json } from "@/server/http";
import { decide } from "@/server/content";

export const POST = route<{ id: string }>(async ({ req, actor, brandId, params }) => ({ asset: await decide(brandId, actor, params.id, (await json(req)) as never) }));
