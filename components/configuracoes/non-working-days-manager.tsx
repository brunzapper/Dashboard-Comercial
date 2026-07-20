// Versão: 1.0 | Data: 20/07/2026
// Gerência de dias não úteis (non_working_days, 0081) — seção da tela de
// Metas (admin). Cadastro manual, edição de rótulo, exclusão e importação de
// CSV parseado no BROWSER (Papa.parse + coerceDate de lib/import/csv.ts —
// aceita dd/mm/aaaa e ISO; 1ª coluna = data, 2ª opcional = rótulo; linha de
// cabeçalho é detectada quando a 1ª coluna não parseia como data). O upsert
// vai em lote para a server action (teto de 500 por chamada).
"use client";

import { useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import { CalendarOff, Plus, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { coerceDate } from "@/lib/import/csv";
import type { NonWorkingDay } from "@/lib/config/non-working-days";
import {
  deleteNonWorkingDay,
  upsertNonWorkingDays,
} from "@/app/(app)/configuracoes/metas/actions";

const WEEKDAYS_PT = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS_PT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y} (${weekday})`;
}

export function NonWorkingDaysManager({ rows }: { rows: NonWorkingDay[] }) {
  const [day, setDay] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(batch: { day: string; label?: string }[]) {
    startTransition(async () => {
      const res = await upsertNonWorkingDays(batch);
      setMessage(res.message ? { ok: Boolean(res.ok), text: res.message } : null);
    });
  }

  function handleAdd() {
    if (!day) {
      setMessage({ ok: false, text: "Informe a data." });
      return;
    }
    submit([{ day, label }]);
    setDay("");
    setLabel("");
  }

  function handleCsv(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const lines = res.data.filter((r) => Array.isArray(r) && r.length > 0);
        const batch: { day: string; label?: string }[] = [];
        const bad: number[] = [];
        lines.forEach((cols, i) => {
          const raw = String(cols[0] ?? "").trim();
          if (!raw) return;
          const iso = coerceDate(raw);
          if (!iso) {
            // 1ª linha sem data válida = cabeçalho; demais são erro de fato.
            if (i > 0) bad.push(i + 1);
            return;
          }
          batch.push({
            day: iso.slice(0, 10),
            label: String(cols[1] ?? "").trim(),
          });
        });
        if (batch.length === 0) {
          setMessage({
            ok: false,
            text: "Nenhuma data válida no CSV (1ª coluna deve ser dd/mm/aaaa ou aaaa-mm-dd).",
          });
          return;
        }
        if (bad.length > 0) {
          setMessage({
            ok: false,
            text: `Linha(s) ignorada(s) sem data válida: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? "…" : ""}. As demais serão importadas.`,
          });
        }
        submit(batch);
      },
      error: () => setMessage({ ok: false, text: "Falha ao ler o CSV." }),
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarOff className="size-4" /> Dias não úteis
        </h2>
        <p className="text-muted-foreground text-sm">
          Feriados e paradas que não contam como dia útil (usados na meta
          ideal/ritmo e nas comparações por dia útil). Dia útil = segunda a
          sexta fora desta lista.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nwd-day">Data</Label>
          <Input
            id="nwd-day"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="flex min-w-48 flex-col gap-1.5">
          <Label htmlFor="nwd-label">Rótulo (opcional)</Label>
          <Input
            id="nwd-label"
            value={label}
            placeholder="Ex.: Carnaval"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button type="button" onClick={handleAdd} disabled={pending}>
          <Plus className="size-4" /> Adicionar
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="size-4" /> Importar CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleCsv(e.target.files?.[0])}
        />
        {message ? (
          <span
            className={
              message.ok
                ? "text-muted-foreground text-sm"
                : "text-destructive text-sm"
            }
          >
            {message.text}
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Rótulo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-muted-foreground text-center"
                >
                  Nenhum dia não útil cadastrado — só fins de semana contam
                  como não úteis.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.day}>
                  <TableCell className="tabular-nums">
                    {displayDate(r.day)}
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={r.label}
                      aria-label={`Rótulo de ${r.day}`}
                      className="h-8 max-w-72"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== r.label)
                          submit([{ day: r.day, label: next }]);
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir ${r.day}`}
                      onClick={() =>
                        startTransition(async () => {
                          await deleteNonWorkingDay(r.day);
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
