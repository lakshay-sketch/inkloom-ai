import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { cookies } from "next/headers";
import { Actor, HttpError, actorFromRole } from "./auth";
import { currentBrand } from "./seed";

export async function currentActor(): Promise<Actor> {
  return actorFromRole((await cookies()).get("inkloom_role")?.value);
}

type Ctx<P> = { params: Promise<P> };
export interface Env<P> { req: NextRequest; actor: Actor; brandId: string; params: P }

/** Wraps a route: resolves actor + brand, maps errors to JSON, never leaks stack traces or secrets. */
export function route<P = Record<string, never>>(fn: (e: Env<P>) => Promise<unknown> | unknown, okStatus = 200) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const brand = await currentBrand();
      const out = await fn({ req, actor: await currentActor(), brandId: brand.id, params: await ctx.params });
      return NextResponse.json(out ?? { ok: true }, { status: okStatus });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        const msg = e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      if (e instanceof SyntaxError) return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
      console.error("[api] unexpected error:", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "Unexpected server error. Your input was not lost on the server if it was saved; please retry." }, { status: 500 });
    }
  };
}

export async function json(req: NextRequest): Promise<unknown> {
  return req.json();
}
