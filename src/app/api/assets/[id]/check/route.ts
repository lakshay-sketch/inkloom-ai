import { route } from "@/server/http";
import { runCheck } from "@/server/content";

// These routes may call the LLM (25 s ceiling) after several database round trips.
export const maxDuration = 60;

export const POST = route<{ id: string }>(async ({ actor, brandId, params }) => await runCheck(brandId, actor, params.id));
