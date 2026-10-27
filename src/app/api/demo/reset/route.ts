import { route } from "@/server/http";
import { resetDemo } from "@/server/seed";
import { assertResetAllowed } from "@/server/auth";

export const POST = route(async ({ actor }) => {
  assertResetAllowed(actor);
  const b = await resetDemo();
  return { ok: true, brand: b.name };
});
