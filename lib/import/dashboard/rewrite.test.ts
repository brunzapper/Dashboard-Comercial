// Versão: 1.0 | Data: 24/07/2026
// Testes da normalização do JSON bruto da IA — o ponto central da segurança de
// identidade da conversa: a `chave` NUNCA é confiada à IA (uma chave copiada
// da referência sobrescreveria o board de ORIGEM no "Criar a partir de").
// Também cobre as injeções do modo Editar cuja ausência seria destrutiva
// (visible_to_roles ausente = des-compartilhar; tabs ausente = widgets sem aba).
import { describe, expect, it } from "vitest";

import { normalizeImportRaw } from "@/lib/import/dashboard/rewrite";

const OPTS = { chave: "canonica-123" };

describe("normalizeImportRaw", () => {
  it("JSON inválido ou não-objeto → devolve o raw INALTERADO", () => {
    expect(normalizeImportRaw("{{{lixo", OPTS)).toBe("{{{lixo");
    expect(normalizeImportRaw("[1,2]", OPTS)).toBe("[1,2]");
    expect(normalizeImportRaw('"texto"', OPTS)).toBe('"texto"');
  });

  it("a chave da IA é SEMPRE sobrescrita pela canônica", () => {
    const out = JSON.parse(
      normalizeImportRaw(JSON.stringify({ chave: "roubada", dashboard: {} }), OPTS)
    );
    expect(out.chave).toBe("canonica-123");
    // Mesmo quando a IA omite a chave.
    expect(JSON.parse(normalizeImportRaw("{}", OPTS)).chave).toBe(
      "canonica-123"
    );
  });

  it("aceita envelope em code fence (```json ... ```)", () => {
    const raw = "```json\n" + JSON.stringify({ chave: "x" }) + "\n```";
    expect(JSON.parse(normalizeImportRaw(raw, OPTS)).chave).toBe("canonica-123");
  });

  it("visible_to_roles: injeta SÓ quando ausente e há currentRoles", () => {
    const roles = ["vendas"];
    const inject = JSON.parse(
      normalizeImportRaw(JSON.stringify({ dashboard: { name: "X" } }), {
        ...OPTS,
        currentRoles: roles,
      })
    );
    expect(inject.dashboard.visible_to_roles).toEqual(roles);
    const keep = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ dashboard: { visible_to_roles: [] } }),
        { ...OPTS, currentRoles: roles }
      )
    );
    // Presente (mesmo vazio = des-compartilhar EXPLÍCITO) → intocado.
    expect(keep.dashboard.visible_to_roles).toEqual([]);
  });

  it("settings.tabs: injeta quando ausente/vazio, cria settings se preciso", () => {
    const tabs = [{ id: "t1", name: "Aba 1" }];
    const semSettings = JSON.parse(
      normalizeImportRaw(JSON.stringify({ dashboard: {} }), {
        ...OPTS,
        currentTabs: tabs,
      })
    );
    expect(semSettings.dashboard.settings.tabs).toEqual(tabs);
    const vazia = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ dashboard: { settings: { tabs: [] } } }),
        { ...OPTS, currentTabs: tabs }
      )
    );
    expect(vazia.dashboard.settings.tabs).toEqual(tabs);
    const existente = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({
          dashboard: { settings: { tabs: [{ id: "t9", name: "Da IA" }] } },
        }),
        { ...OPTS, currentTabs: tabs }
      )
    );
    expect(existente.dashboard.settings.tabs).toEqual([
      { id: "t9", name: "Da IA" },
    ]);
  });

  it("avoidName: colisão (com trim) ganha sufixo ' (cópia)'", () => {
    const colide = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ dashboard: { name: " Comercial " } }),
        { ...OPTS, avoidName: "Comercial" }
      )
    );
    expect(colide.dashboard.name).toBe("Comercial (cópia)");
    const diferente = JSON.parse(
      normalizeImportRaw(JSON.stringify({ dashboard: { name: "Outro" } }), {
        ...OPTS,
        avoidName: "Comercial",
      })
    );
    expect(diferente.dashboard.name).toBe("Outro");
  });
});
