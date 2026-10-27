import { route, json } from "@/server/http";
import { updateFact } from "@/server/ledger";

export const PATCH = route<{ id: string }>(async ({ req, actor, brandId, params }) => await updateFact(brandId, actor, params.id, (await json(req)) as never));
