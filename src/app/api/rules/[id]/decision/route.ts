import { z } from "zod";
import { route, json } from "@/server/http";
import { decideRule } from "@/server/knowledge";

export const POST = route<{ id: string }>(async ({ req, actor, brandId, params }) => {
  const { decision } = z.object({ decision: z.enum(["approved", "rejected", "draft"]) }).parse(await json(req));
  return { rule: await decideRule(brandId, actor, params.id, decision) };
});
