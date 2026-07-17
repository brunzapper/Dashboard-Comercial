// Versão: 1.0 | Data: 17/07/2026
// API de ingestão (push): sistemas externos empurram dados para o dashboard.
// POST /api/ingest/<source_key> com Authorization: Bearer dck_... — chave POR
// integração criada em Configurações → Integrações (api_keys, migração 0074;
// desenho em docs/estudo-ingestao-api.md §2). Dois modos de payload:
//   { event_id?, rows: [...] }  → upsert via ingestRows (mapping salvo na chave)
//   { event_id?, event: {...} } → só armazena (processamento futuro), 202
// Idempotência: event_id repetido pela mesma chave não reprocessa (dedup no
// banco); reenvio após erro reprocessa. Falhas de auth respondem 401 UNIFORME
// (sem distinguir fonte inexistente / chave errada / revogada — anti-enumeração).
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { hashKey, isApiKeyShaped } from "@/lib/integrations/keys";
import { ingestRows } from "@/lib/import/ingest";
import type { ColumnMapping } from "@/lib/import/csv";
import { loadSources } from "@/lib/config/sources";
import { runAutoMatch } from "@/lib/records/matching-engine";
import { recalcAllFormulaFields } from "@/lib/records/recalc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mesmo teto do importCsvChunk; quem tem mais linhas, pagina (upsert é idempotente).
const MAX_ROWS = 500;
const MAX_BODY_BYTES = 1_000_000;
// Regex de key de data_sources (0060) — pré-gate antes de tocar o banco.
const SOURCE_RE = /^[a-z][a-z0-9_]{1,39}$/;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "não autorizado" }, { status: 401 });
}

interface Payload {
  event_id?: unknown;
  rows?: unknown;
  event?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ source: string }> }
) {
  try {
    const { source } = await params;
    if (!SOURCE_RE.test(source)) return unauthorized();

    // Bearer-only (as rotas de sync aceitam x-sync-secret; aqui não).
    const auth = request.headers.get("authorization");
    const bearer = auth?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!isApiKeyShaped(bearer)) return unauthorized();

    const db = createServiceClient();
    const computedHash = hashKey(bearer);
    const { data: key } = await db
      .from("api_keys")
      .select(
        "id, key_hash, source_key, mapping, dedup_columns, created_by, revoked_at"
      )
      .eq("key_hash", computedHash)
      .maybeSingle();
    if (
      !key ||
      key.key_hash.length !== computedHash.length ||
      !timingSafeEqual(Buffer.from(key.key_hash), Buffer.from(computedHash)) ||
      key.revoked_at !== null ||
      key.source_key !== source
    ) {
      return unauthorized();
    }

    // Corpo: teto de 1 MB e JSON válido.
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
    }
    let payload: Payload;
    try {
      payload = JSON.parse(text) as Payload;
    } catch {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }
    if (typeof payload !== "object" || payload === null) {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }

    const eventId =
      typeof payload.event_id === "string" && payload.event_id.trim() !== ""
        ? payload.event_id.trim().slice(0, 200)
        : null;

    // Modo do payload (valida ANTES de registrar o evento, para que um reenvio
    // corrigido com o mesmo event_id não caia no dedup de um 400).
    const isRowsMode = Array.isArray(payload.rows);
    const isEventMode =
      !isRowsMode && typeof payload.event === "object" && payload.event !== null;
    if (!isRowsMode && !isEventMode) {
      return NextResponse.json(
        { error: 'payload inválido: envie "rows" (array) ou "event" (objeto)' },
        { status: 400 }
      );
    }

    let rows: Record<string, unknown>[] = [];
    if (isRowsMode) {
      rows = (payload.rows as unknown[]).filter(
        (r): r is Record<string, unknown> => typeof r === "object" && r !== null
      );
      if (rows.length === 0 || rows.length > MAX_ROWS) {
        return NextResponse.json(
          { error: `envie de 1 a ${MAX_ROWS} linhas (objetos) por requisição` },
          { status: 400 }
        );
      }
      const mapping = (key.mapping as ColumnMapping[] | null) ?? null;
      if (!mapping || mapping.length === 0) {
        return NextResponse.json(
          { error: "chave sem mapeamento configurado" },
          { status: 400 }
        );
      }
    }

    // Registro do evento recebido (log + idempotência por event_id).
    const kind = isRowsMode ? "rows" : "event";
    let inboundId: string;
    const { data: inserted, error: insErr } = await db
      .from("webhook_inbound_events")
      .insert({
        api_key_id: key.id,
        external_event_id: eventId,
        kind,
        payload: payload as Record<string, unknown>,
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === "23505" && eventId) {
        // Já recebido: reprocessa só se a tentativa anterior falhou.
        const { data: prev } = await db
          .from("webhook_inbound_events")
          .select("id, status")
          .eq("api_key_id", key.id)
          .eq("external_event_id", eventId)
          .maybeSingle();
        if (!prev || prev.status !== "error") {
          return NextResponse.json({ ok: true, duplicate: true });
        }
        inboundId = prev.id;
        await db
          .from("webhook_inbound_events")
          .update({ status: "received", error: null, kind, payload })
          .eq("id", prev.id);
      } else {
        throw new Error(insErr.message);
      }
    } else {
      inboundId = inserted.id;
    }

    // Carimbo de uso (best-effort; corrida entre requests é aceitável).
    void db
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id)
      .then(() => undefined);

    if (!isRowsMode) {
      // Evento genérico: só armazenado, processamento futuro.
      return NextResponse.json({ ok: true, stored: true }, { status: 202 });
    }

    // Modo rows: mesmo motor do import de CSV (upsert idempotente por dedup).
    const sources = await loadSources(db);
    const sourceDef = sources.find((s) => s.key === source);
    if (!sourceDef) {
      // FK garante a fonte no catálogo; aqui só se caiu no fallback builtin.
      await db
        .from("webhook_inbound_events")
        .update({ status: "error", error: "fonte não encontrada no catálogo" })
        .eq("id", inboundId);
      return NextResponse.json(
        { ok: false, error: "fonte não encontrada" },
        { status: 500 }
      );
    }

    try {
      const result = await ingestRows(
        db,
        {
          sourceKey: source,
          recordType: sourceDef.recordType,
          mapping: key.mapping as ColumnMapping[],
          dedupColumns: (key.dedup_columns as string[] | null) ?? [],
          userId: key.created_by,
          auditOrigin: "api",
        },
        rows
      );
      await db
        .from("webhook_inbound_events")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          result,
        })
        .eq("id", inboundId);
      // Cauda best-effort, como na rota de sheets: auto-match + fórmulas.
      try {
        await runAutoMatch(db);
        await recalcAllFormulaFields();
      } catch {
        /* ignora: as linhas já foram persistidas. */
      }
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      await db
        .from("webhook_inbound_events")
        .update({ status: "error", error: (e as Error).message })
        .eq("id", inboundId);
      throw e;
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
