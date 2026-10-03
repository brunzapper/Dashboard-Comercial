// Versão: 1.0 | Data: 03/10/2026
// Sessão via CLAIMS + `session_context` (0151). Os helpers puros decidem quem
// é o usuário e o que ele pode — um parse frouxo aqui daria permissão que o
// banco não deu, então o formato fora do contrato vira null (as consultas de
// sempre assumem).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { parseSessionContext, sessionUserFromClaims } from "./session";

describe("sessionUserFromClaims", () => {
  it("sub vira id; email vem junto quando existe", () => {
    expect(sessionUserFromClaims({ sub: "u1", email: "a@b.c" })).toEqual({
      id: "u1",
      email: "a@b.c",
    });
    expect(sessionUserFromClaims({ sub: "u1" })).toEqual({ id: "u1" });
  });

  it("sem sub não há usuário", () => {
    expect(sessionUserFromClaims(null)).toBeNull();
    expect(sessionUserFromClaims({ email: "a@b.c" })).toBeNull();
    expect(sessionUserFromClaims({ sub: "" })).toBeNull();
  });
});

describe("parseSessionContext", () => {
  it("papéis, permissões (sem duplicata) e memberships com a org", () => {
    const parsed = parseSessionContext({
      roles: ["admin"],
      permissions: ["view_all_records", "view_all_records", 3],
      memberships: [
        {
          organization_id: "o1",
          is_org_admin: true,
          org: { id: "o1", name: "Zapper", app_name: null, theme: null, ui_prefs: null },
        },
        { organization_id: "o2", is_org_admin: false, org: null },
        { is_org_admin: true },
      ],
    });
    expect(parsed).toEqual({
      roles: ["admin"],
      permissions: ["view_all_records"],
      memberships: [
        {
          organization_id: "o1",
          is_org_admin: true,
          org: { id: "o1", name: "Zapper", app_name: null, theme: null, ui_prefs: null },
        },
        { organization_id: "o2", is_org_admin: false, org: null },
      ],
    });
  });

  it("formato fora do contrato ⇒ null (cai nas consultas de sempre)", () => {
    expect(parseSessionContext(null)).toBeNull();
    expect(parseSessionContext({ roles: [] })).toBeNull();
    expect(parseSessionContext({ roles: [], permissions: [] })).toBeNull();
  });
});
