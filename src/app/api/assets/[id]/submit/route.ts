import { route } from "@/server/http";
import { submitForReview } from "@/server/content";

export const POST = route<{ id: string }>(async ({ actor, brandId, params }) => ({ asset: await submitForReview(brandId, actor, params.id) }));
