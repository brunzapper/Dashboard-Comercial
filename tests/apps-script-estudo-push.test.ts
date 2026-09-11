// Versão: 1.0 | Data: 11/09/2026
// Guarda do Apps Script que ALIMENTA o sistema
// (integrations/apps-script/push_estudo_fechamentos.gs). Como o irmão
// apps-script-sheets.test.ts, o arquivo não é importável pelo app (roda no
// Google), então é AVALIADO num `vm` com stubs mínimos — a única cobertura
// possível de um script que só existe publicado. Até 11/09/2026 este `.gs` não
// tinha teste nenhum.
//
// O que está pinado é exatamente aquilo de que a VARREDURA (0140) depende, e
// que não pode ser afrouxado sem risco de apagar dado:
//   - todos os chunks de uma execução carregam o MESMO push_id, numerados
//     1..N (é o que deixa o servidor saber que a planilha veio inteira);
//   - o primeiro chunk não-2xx ABORTA os seguintes (sem isso o quadro fecharia
//     com a planilha meio-enviada e a varredura apagaria o que não foi lido);
//   - planilha vazia NÃO envia nada (um push vazio "completo" pediria a
//     varredura da base inteira).
import { readFileSync } from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it } from "vitest";

const GS_PATH = path.resolve(
  __dirname,
  "../integrations/apps-script/push_estudo_fechamentos.gs"
);

interface SentRequest {
  url: string;
  body: Record<string, unknown>;
}

interface RunOptions {
  /** Linhas da aba "Site" (matriz crua, com cabeçalho). */
  site: unknown[][];
  /** Códigos HTTP devolvidos, na ordem dos POSTs. */
  codes?: number[];
}

function runScript(opts: RunOptions) {
  const sent: SentRequest[] = [];
  const logs: unknown[][] = [];
  let uuidSeq = 0;
  const codes = [...(opts.codes ?? [])];

  const sheet = (values: unknown[][]) => ({
    getDataRange: () => ({ getValues: () => values }),
  });

  // A aba "Leads Base" da planilha Inbound Zapper — só alimenta o lead time.
  const leadsValues = [["Nome do Lead", "Criado"]];

  const context = {
    CONFIG: undefined,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) =>
          k === "ENDPOINT_URL" ? "https://app.exemplo/api/sync/sheets" : "segredo",
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name: string) =>
          name === "Site" ? sheet(opts.site) : null,
      }),
      openById: () => ({
        getSheetByName: (name: string) =>
          name === "Leads Base" ? sheet(leadsValues) : null,
      }),
    },
    UrlFetchApp: {
      fetch: (url: string, params: { payload: string }) => {
        sent.push({ url, body: JSON.parse(params.payload) });
        const code = codes.length > 0 ? (codes.shift() as number) : 200;
        return {
          getResponseCode: () => code,
          getContentText: () => JSON.stringify({ ok: code < 300 }),
        };
      },
    },
    Utilities: {
      getUuid: () => `uuid-${++uuidSeq}`,
      formatDate: (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      },
    },
    Session: { getScriptTimeZone: () => "America/Sao_Paulo" },
    Logger: {
      log: (...args: unknown[]) => {
        logs.push(args);
      },
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({
        timeBased: () => ({ everyHours: () => ({ create: () => undefined }) }),
      }),
    },
  };

  const ctx = createContext(context);
  runInContext(readFileSync(GS_PATH, "utf8"), ctx);
  let threw: Error | null = null;
  try {
    (ctx as unknown as { pushEstudoFechamentos: () => void }).pushEstudoFechamentos();
  } catch (e) {
    threw = e as Error;
  }
  return { sent, logs, threw };
}

const HEADER = [
  "Name",
  "Email",
  "Seats",
  "Plan",
  "Products",
  "Created At",
  "Contract",
  "MRR",
  "Consultor",
  "Etapa no CRM",
  "Canal",
  "Campanha",
];

function siteRow(name: string, email = `${name}@ex.com`): unknown[] {
  return [name, email, 1, "Plano", "Produto", "01/08/2026", 100, 100, "Fulano", "Ganho", "Site", ""];
}

describe("push_estudo_fechamentos.gs", () => {
  it("envia a planilha enquadrada: mesmo push_id, chunk 1..N", () => {
    const { sent, threw } = runScript({
      site: [HEADER, siteRow("Cliente Um"), siteRow("Cliente Dois")],
    });
    expect(threw).toBeNull();
    expect(sent).toHaveLength(1);
    const body = sent[0].body;
    expect(body.source).toBe("estudo_fechamentos_site");
    expect(body.push_id).toBe("uuid-1");
    expect(body.chunk).toBe(1);
    expect(body.chunks).toBe(1);
    expect((body.rows as unknown[]).length).toBe(2);
  });

  it("um push_id por EXECUÇÃO, compartilhado por todos os chunks", () => {
    // 600 linhas = 2 chunks de ≤500. Os dois têm de fechar o MESMO quadro.
    const rows = Array.from({ length: 600 }, (_, i) => siteRow(`Cliente ${i}`));
    const { sent } = runScript({ site: [HEADER, ...rows] });
    expect(sent).toHaveLength(2);
    expect(sent[0].body.push_id).toBe(sent[1].body.push_id);
    expect(sent.map((s) => s.body.chunk)).toEqual([1, 2]);
    expect(sent.map((s) => s.body.chunks)).toEqual([2, 2]);
    expect((sent[0].body.rows as unknown[]).length).toBe(500);
    expect((sent[1].body.rows as unknown[]).length).toBe(100);
  });

  it("chunk não-2xx ABORTA os seguintes — o quadro nunca fecha pela metade", () => {
    const rows = Array.from({ length: 600 }, (_, i) => siteRow(`Cliente ${i}`));
    const { sent, threw } = runScript({ site: [HEADER, ...rows], codes: [500] });
    expect(threw).not.toBeNull();
    expect(sent).toHaveLength(1); // o 2º chunk não chegou a sair
  });

  it("planilha vazia não envia nada", () => {
    const { sent, threw } = runScript({ site: [HEADER] });
    expect(threw).toBeNull();
    expect(sent).toEqual([]);
  });

  it("linha sem nome ou sem data é descartada antes do envio", () => {
    const semNome = siteRow("");
    const semData = siteRow("Cliente Três");
    semData[5] = "";
    const { sent } = runScript({
      site: [HEADER, siteRow("Cliente Um"), semNome, semData],
    });
    expect((sent[0].body.rows as { name: string }[]).map((r) => r.name)).toEqual([
      "Cliente Um",
    ]);
  });
});
