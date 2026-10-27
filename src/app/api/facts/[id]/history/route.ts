import { route } from "@/server/http";
import { factHistory, getFact } from "@/server/knowledge";

export const GET = route<{ id: string }>(async ({ brandId, params }) => {
  await getFact(brandId, params.id);
  return { versions: await factHistory(brandId, params.id) };
});
