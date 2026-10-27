import { route } from "@/server/http";
import { proposeRules } from "@/server/knowledge";

// These routes may call the LLM (25 s ceiling) after several database round trips.
export const maxDuration = 60;

export const POST = route<{ id: string }>(async ({ actor, brandId, params }) => await proposeRules(brandId, actor, params.id));
