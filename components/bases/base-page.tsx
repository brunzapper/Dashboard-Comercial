// Versão: 1.0 | Data: 19/11/2026
// Cliente da PÁGINA DA BASE (esquema por Base, fase 4). Recebe o modelo pronto
// do servidor (lib/records/base-page.ts) e só desenha + chama as actions do
// esquema. Abas montadas todas (as inativas com `hidden`), como em /campos —
// busca digitada e edição em curso sobrevivem à troca de aba.
"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DATA_TYPE_LABELS } from "@/lib/records/types";
import {
  ORIGIN_LABELS,
  type BaseFieldRow,
  type BaseQuality,
} from "@/lib/records/base-page";
import { cn } from "@/lib/utils";
import {
  adoptBaseFields,
  refreshBaseFromBitrix,
  setBaseFieldLabel,
  setBaseFieldsVisible,
  type BaseActionResult,
} from "@/app/(app)/registros/bases/[key]/actions";

export interface BaseOverview {
  key: string;
  label: string;
  shortLabel: string;
  recordType: string;
  total: number;
  lastSyncedAt: string | null;
  origin: string;
  isBitrix: boolean;
  manualEntry: boolean;
  subBases: { key: string; label: string }[];
}

type TabKey = "geral" | "campos" | "qualidade" | "subbases" | "origem";
type FieldFilter = "todos" | "novos" | "removidos" | "ocultos";

const TYPE_LABELS: Record<string, string> = {
  ...(DATA_TYPE_LABELS as Record<string, string>),
  relacao: "Relação",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function BasePage({
  overview,
  rows,
  quality,
  canWrite,
}: {
  overview: BaseOverview;
  rows: BaseFieldRow[];
  quality: BaseQuality;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("geral");
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<BaseActionResult>) => {
    setBusyKey(key);
    startTransition(async () => {
      const res = await fn();
      setBusyKey(null);
      if (!res.ok) toast.error(res.message ?? "Não foi possível salvar.");
      else {
        if (res.message) toast.success(res.message);
        router.refresh();
      }
    });
  };

  const counts = {
    novos: rows.filter((r) => r.isNew).length,
    removidos: rows.filter((r) => r.removed).length,
    ocultos: rows.filter((r) => !r.visible).length,
  };
  const qualityCount =
    quality.outside.length +
    quality.coreOutside.length +
    quality.neverFilled.length +
    quality.internalNames.length +
    quality.removed.length;

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: "geral", label: "Visão geral" },
    { key: "campos", label: "Campos", badge: rows.length },
    { key: "qualidade", label: "Qualidade", badge: qualityCount || undefined },
    { key: "subbases", label: "Sub-bases", badge: overview.subBases.length || undefined },
    { key: "origem", label: "Origem" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                t.key === tab
                  ? "border-brand text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
            >
              {t.label}
              {t.badge ? (
                <span className="bg-muted text-muted-foreground rounded px-1.5 text-xs">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
          <Link
            href={`/registros?fonte=${overview.key}`}
            className="text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium"
          >
            Registros ↗
          </Link>
        </div>
        {overview.isBitrix && canWrite ? (
          <Button
            size="sm"
            variant="outline"
            className="mb-1"
            disabled={pending}
            onClick={() => run("refresh", () => refreshBaseFromBitrix(overview.key))}
          >
            {busyKey === "refresh" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Atualizar do Bitrix
          </Button>
        ) : null}
      </div>

      <div hidden={tab !== "geral"}>
        <Overview
          overview={overview}
          fields={rows.length}
          counts={counts}
          qualityCount={qualityCount}
          onGo={setTab}
        />
      </div>
      <div hidden={tab !== "campos"}>
        <FieldsTab
          overview={overview}
          rows={rows}
          counts={counts}
          canWrite={canWrite}
          busyKey={busyKey}
          run={run}
        />
      </div>
      <div hidden={tab !== "qualidade"}>
        <QualityTab
          overview={overview}
          quality={quality}
          canWrite={canWrite}
          busyKey={busyKey}
          run={run}
        />
      </div>
      <div hidden={tab !== "subbases"}>
        <SubBasesTab overview={overview} />
      </div>
      <div hidden={tab !== "origem"}>
        <OriginTab overview={overview} />
      </div>
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent flex flex-col items-start gap-1 rounded-lg border p-4 text-left"
    >
      {body}
    </button>
  ) : (
    <div className="flex flex-col gap-1 rounded-lg border p-4">{body}</div>
  );
}

function Overview({
  overview,
  fields,
  counts,
  qualityCount,
  onGo,
}: {
  overview: BaseOverview;
  fields: number;
  counts: { novos: number; removidos: number; ocultos: number };
  qualityCount: number;
  onGo: (t: TabKey) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Registros" value={overview.total.toLocaleString("pt-BR")} />
        <Stat label="Campos no esquema" value={String(fields)} onClick={() => onGo("campos")} />
        <Stat
          label="Campos novos (7 dias)"
          value={String(counts.novos)}
          onClick={() => onGo("campos")}
        />
        <Stat
          label="Pontos de atenção"
          value={String(qualityCount)}
          onClick={() => onGo("qualidade")}
        />
      </div>
      <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Origem</dt>
        <dd>{overview.origin}</dd>
        <dt className="text-muted-foreground">Última sincronização</dt>
        <dd>{fmtDate(overview.lastSyncedAt)}</dd>
        <dt className="text-muted-foreground">Removidos na origem</dt>
        <dd>{counts.removidos}</dd>
        <dt className="text-muted-foreground">Ocultos nesta Base</dt>
        <dd>{counts.ocultos}</dd>
      </dl>
    </div>
  );
}

function FieldsTab({
  overview,
  rows,
  counts,
  canWrite,
  busyKey,
  run,
}: {
  overview: BaseOverview;
  rows: BaseFieldRow[];
  counts: { novos: number; removidos: number; ocultos: number };
  canWrite: boolean;
  busyKey: string | null;
  run: (key: string, fn: () => Promise<BaseActionResult>) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FieldFilter>("todos");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "novos" && !r.isNew) return false;
      if (filter === "removidos" && !r.removed) return false;
      if (filter === "ocultos" && r.visible) return false;
      if (!q) return true;
      return (
        r.label.toLowerCase().includes(q) ||
        r.globalLabel.toLowerCase().includes(q) ||
        (r.originRef ?? "").toLowerCase().includes(q) ||
        r.ref.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  const saveLabel = (r: BaseFieldRow) => {
    setEditing(null);
    if ((draft.trim() || null) === r.baseLabel) return;
    run(`label:${r.ref}`, () => setBaseFieldLabel(overview.key, r.ref, draft));
  };

  const chips: { key: FieldFilter; label: string; n?: number }[] = [
    { key: "todos", label: "Todos", n: rows.length },
    { key: "novos", label: "Novos", n: counts.novos },
    { key: "removidos", label: "Removidos na origem", n: counts.removidos },
    { key: "ocultos", label: "Ocultos", n: counts.ocultos },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Os campos que os registros de {overview.shortLabel || overview.label} têm. O
        nome e o olho valem SÓ nesta Base; o campo continua existindo nas outras.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome ou código (UF_CRM…)"
          aria-label="Buscar campo"
          className="w-72"
        />
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              filter === c.key ? "bg-brand/10 border-brand text-brand" : "text-muted-foreground"
            )}
          >
            {c.label} {c.n ? `(${c.n})` : ""}
          </button>
        ))}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Preenchido</TableHead>
              <TableHead className="w-12 text-center">Visível</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-sm">
                  Nenhum campo.
                </TableCell>
              </TableRow>
            ) : null}
            {visibleRows.map((r) => (
              <TableRow key={r.ref} className={cn(!r.visible && "opacity-60")}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    {editing === r.ref ? (
                      <Input
                        autoFocus
                        value={draft}
                        placeholder={r.globalLabel}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => saveLabel(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveLabel(r);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        aria-label={`Nome de ${r.label} nesta Base`}
                        className="h-8 w-64"
                      />
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!canWrite}
                          title={canWrite ? "Renomear nesta Base" : undefined}
                          onClick={() => {
                            setEditing(r.ref);
                            setDraft(r.baseLabel ?? "");
                          }}
                          className={cn(
                            "text-left font-medium",
                            canWrite && "hover:underline",
                            r.internalName && "text-amber-700 dark:text-amber-400"
                          )}
                        >
                          {r.label}
                        </button>
                        {r.isNew ? <Badge variant="secondary">Novo</Badge> : null}
                        {r.removed ? (
                          <Badge variant="outline" className="text-destructive">
                            Removido na origem
                          </Badge>
                        ) : null}
                        {r.internalName ? (
                          <Badge variant="outline">Nome interno</Badge>
                        ) : null}
                        {busyKey === `label:${r.ref}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                      </span>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {r.baseLabel && r.baseLabel !== r.globalLabel
                        ? `global: ${r.globalLabel} · `
                        : ""}
                      {r.originRef ?? r.ref}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {TYPE_LABELS[r.dataType] ?? r.dataType}
                </TableCell>
                <TableCell className="text-sm">
                  {ORIGIN_LABELS[r.origin] ?? r.origin}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.filledPct == null ? "—" : `${r.filledPct.toLocaleString("pt-BR")}%`}
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={!canWrite || busyKey === `eye:${r.ref}`}
                    aria-label={r.visible ? `Ocultar ${r.label}` : `Mostrar ${r.label}`}
                    onClick={() =>
                      run(`eye:${r.ref}`, () =>
                        setBaseFieldsVisible(overview.key, [r.ref], !r.visible)
                      )
                    }
                  >
                    {busyKey === `eye:${r.ref}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : r.visible ? (
                      <Eye className="size-4" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function QualitySection({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-muted-foreground text-sm">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function QualityTab({
  overview,
  quality,
  canWrite,
  busyKey,
  run,
}: {
  overview: BaseOverview;
  quality: BaseQuality;
  canWrite: boolean;
  busyKey: string | null;
  run: (key: string, fn: () => Promise<BaseActionResult>) => void;
}) {
  const nothing =
    quality.outside.length +
      quality.coreOutside.length +
      quality.neverFilled.length +
      quality.internalNames.length +
      quality.removed.length ===
    0;
  if (nothing) {
    return <p className="text-muted-foreground text-sm">Nada fora do lugar nesta Base.</p>;
  }
  const list = (items: { ref: string; label: string; extra?: string }[]) => (
    <ul className="flex max-h-64 flex-col gap-1 overflow-auto text-sm">
      {items.map((i) => (
        <li key={i.ref} className="flex items-center justify-between gap-2">
          <span className="truncate">
            {i.label}{" "}
            <span className="text-muted-foreground text-xs">{i.extra ?? i.ref}</span>
          </span>
          {canWrite && i.ref ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busyKey === `adopt:${i.ref}`}
              onClick={() =>
                run(`adopt:${i.ref}`, () => adoptBaseFields(overview.key, [i.ref]))
              }
            >
              Adotar
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4">
      {quality.outside.length > 0 ? (
        <QualitySection
          title="Valores fora do esquema"
          hint="Registros desta Base guardam estas chaves, mas elas não são campos dela. Adote as que fazem sentido aqui; as outras continuam guardadas e só aparecem no registro que tem valor."
          action={
            canWrite ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === "adopt:all"}
                onClick={() =>
                  run("adopt:all", () =>
                    adoptBaseFields(
                      overview.key,
                      quality.outside.map((o) => o.ref)
                    )
                  )
                }
              >
                Adotar todos
              </Button>
            ) : null
          }
        >
          {list(
            quality.outside.map((o) => ({
              ref: o.ref,
              label: o.label,
              extra: `${o.filled.toLocaleString("pt-BR")} registros${o.defined ? "" : " · sem definição"}`,
            }))
          )}
        </QualitySection>
      ) : null}
      {quality.coreOutside.length > 0 ? (
        <QualitySection
          title="Colunas do sistema com valor, fora do perfil"
          hint="Ex.: MRR ou Pipeline gravados em poucos registros. Adotar põe a coluna no perfil desta Base (aparece em todo registro)."
        >
          {list(
            quality.coreOutside.map((o) => ({
              ref: o.ref,
              label: o.label,
              extra: `${o.filled.toLocaleString("pt-BR")} registros`,
            }))
          )}
        </QualitySection>
      ) : null}
      {quality.neverFilled.length > 0 ? (
        <QualitySection
          title="Campos nunca preenchidos"
          hint="Estão no esquema mas nenhum registro tem valor. Ocultar tira do registro desta Base — nada é apagado."
          action={
            canWrite ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === "hide:all"}
                onClick={() =>
                  run("hide:all", () =>
                    setBaseFieldsVisible(
                      overview.key,
                      quality.neverFilled.map((r) => r.ref),
                      false
                    )
                  )
                }
              >
                Ocultar todos
              </Button>
            ) : null
          }
        >
          <p className="text-sm">
            {quality.neverFilled.map((r) => r.label).join(" · ")}
          </p>
        </QualitySection>
      ) : null}
      {quality.internalNames.length > 0 ? (
        <QualitySection
          title="Nomes internos"
          hint="O nome é o código do Bitrix. Use “Atualizar do Bitrix” para buscar o nome da tela, ou renomeie na aba Campos."
        >
          <p className="text-sm">
            {quality.internalNames.map((r) => r.label).join(" · ")}
          </p>
        </QualitySection>
      ) : null}
      {quality.removed.length > 0 ? (
        <QualitySection
          title="Removidos na origem"
          hint="A origem parou de enviar estes campos. Os valores antigos seguem guardados e os widgets que os usam continuam funcionando."
        >
          <p className="text-sm">{quality.removed.map((r) => r.label).join(" · ")}</p>
        </QualitySection>
      ) : null}
    </div>
  );
}

function SubBasesTab({ overview }: { overview: BaseOverview }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Sub-bases são recortes salvos desta Base (mesmos registros, um filtro a
        mais) e usam o esquema dela.
      </p>
      {overview.subBases.length === 0 ? (
        <p>Nenhuma sub-base.</p>
      ) : (
        <ul className="list-disc pl-5">
          {overview.subBases.map((s) => (
            <li key={s.key}>{s.label}</li>
          ))}
        </ul>
      )}
      <Link className="underline" href="/registros/bases">
        Criar ou editar sub-bases
      </Link>
    </div>
  );
}

function OriginTab({ overview }: { overview: BaseOverview }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <span className="text-muted-foreground">Alimentada por: </span>
        {overview.origin}
      </p>
      {overview.isBitrix ? (
        <p className="text-muted-foreground">
          Campos novos do Bitrix entram sozinhos a cada sincronização, com o nome
          da tela do Bitrix. Para não esperar, use “Atualizar do Bitrix”.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Link className="underline" href="/registros/importar">
          Importar CSV
        </Link>
        <Link className="underline" href="/configuracoes/integracoes">
          Integrações (API)
        </Link>
        <Link className="underline" href="/registros/bases">
          Configuração da Base
        </Link>
      </div>
    </div>
  );
}
