import { all, newId, now, run } from "./db";

export type Role = "creator" | "reviewer" | "manager";
export interface Actor {
  name: string;
  role: Role;
}

/** DEMO identities only. This is a role switch, not authentication. */
export const DEMO_USERS: Record<Role, Actor> = {
  creator: { name: "Asha (Content Creator)", role: "creator" },
  reviewer: { name: "Ravi (Reviewer)", role: "reviewer" },
  manager: { name: "Meera (Brand Manager)", role: "manager" },
};

export const ROLE_LABEL: Record<Role, string> = { creator: "Creator", reviewer: "Reviewer", manager: "Brand Manager" };

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Demo role switching is NOT authentication: whoever can set the cookie can pick any role. It is therefore only
 * on by default outside production. In production it must be opted into (DEMO_ROLE_SWITCH=1); otherwise the cookie
 * is ignored and every visitor is a Creator (least privilege).
 */
export function roleSwitchEnabled(): boolean {
  const v = process.env.DEMO_ROLE_SWITCH;
  if (v === "1") return true;
  if (v === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/** The destructive "reset demo data" action is off unless DEMO_RESET_ENABLED=1. */
export function resetEnabled(): boolean {
  return process.env.DEMO_RESET_ENABLED === "1";
}

export function assertResetAllowed(actor: Actor) {
  if (!resetEnabled()) throw new HttpError(403, "Resetting demo data is disabled on this deployment (set DEMO_RESET_ENABLED=1 to allow it).");
  requireRole(actor, ["manager"], "reset the demo (it deletes ALL data)");
}

export function actorFromRole(value: string | undefined | null): Actor {
  if (!roleSwitchEnabled()) return DEMO_USERS.creator;
  return DEMO_USERS[(value as Role) in DEMO_USERS ? (value as Role) : "manager"];
}

export function requireRole(actor: Actor, roles: Role[], what: string) {
  if (!roles.includes(actor.role)) {
    throw new HttpError(403, `${ROLE_LABEL[actor.role]} cannot ${what}. Switch the demo role to ${roles.map((r) => ROLE_LABEL[r]).join(" or ")}.`);
  }
}

export async function audit(brandId: string, actor: Actor, action: string, entityType: string, entityId: string, detail = "") {
  await run(
    "INSERT INTO audit_events (id, brand_id, action, entity_type, entity_id, actor, role, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    newId("AU"), brandId, action, entityType, entityId, actor.name, actor.role, detail, now(),
  );
}

export interface AuditRow {
  id: string; action: string; entity_type: string; entity_id: string; actor: string; role: string; detail: string; created_at: string;
}
export async function listAudit(brandId: string, limit = 200): Promise<AuditRow[]> {
  return await all<AuditRow>("SELECT id, action, entity_type, entity_id, actor, role, detail, created_at FROM audit_events WHERE brand_id = ? ORDER BY created_at DESC, seq DESC LIMIT ?", brandId, limit);
}
