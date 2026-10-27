import { route, json } from "@/server/http";
import { editRule } from "@/server/knowledge";

export const PATCH = route<{ id: string }>(async ({ req, actor, brandId, params }) => ({ rule: await editRule(brandId, actor, params.id, (await json(req)) as never) }));
