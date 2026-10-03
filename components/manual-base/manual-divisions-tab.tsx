// Versão: 1.0 | Data: 03/10/2026
// v1.0 (03/10/2026): a aba DIVISÕES da Base manual (tela v2).
//
// Uma divisão ("Canal", "Componente do investimento") é uma maneira de
// repartir o MESMO número; as opções ("Ligação", "E-mail") são as partes, e a
// ordem delas é a ordem das barras nos gráficos. Antes a tela só criava e
// excluía — não dava para renomear divisão nem opção, nem reordenar, e no ⋮ do
// dashboard o que se criava não aparecia. Aqui tudo é editável no lugar.
//
// Responsável e Operação são divisões do SISTEMA (registry em código): as
// opções delas são o cadastro de responsáveis/operações, então o cartão é só
// leitura.
"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpHint } from "@/components/ui/help-hint";
import { Input } from "@/components/ui/input";
import {
  BUILTIN_MANUAL_FAMILIES,
  coordMember,
  coordDeclares,
  type ManualFamily,
} from "@/lib/manual-base/families";
import { MANUAL_TERMS, countLabel } from "@/lib/manual-base/vocabulary";

import { isTempId, type ManualBaseStore } from "./use-manual-base-store";

/** Input de renomear no lugar: salva no blur/Enter, Esc desfaz. */
function InlineName({
  value,
  label,
  disabled,
  minLength,
  className,
  onCommit,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  minLength: number;
  className?: string;
  onCommit: (v: string) => void;
}) {
  if (disabled) return <span className={className}>{value}</span>;
  return (
    <Input
      key={value}
      aria-label={label}
      className={className}
      defaultValue={value}
      onBlur={(ev) => {
        const v = ev.target.value.trim();
        if (v.length < minLength) {
          ev.target.value = value;
          return;
        }
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") ev.currentTarget.blur();
        if (ev.key === "Escape") {
          ev.currentTarget.value = value;
          ev.currentTarget.blur();
        }
      }}
    />
  );
}

export function ManualDivisionsTab({
  store,
  canEdit,
}: {
  store: ManualBaseStore;
  canEdit: boolean;
}) {
  const { families, series, state } = store;
  const [newFamily, setNewFamily] = useState("");
  const [newMember, setNewMember] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ManualFamily | null>(null);

  const usedBy = (key: string) =>
    series.filter((s) => (state.declarations[s.id] ?? []).includes(key)).map((s) => s.label);
  const entriesUsing = (key: string) =>
    state.entries.filter((e) => coordDeclares(e.coords, key)).length;
  const entriesUsingMember = (famKey: string, memberKey: string) =>
    state.entries.filter((e) => coordMember(e.coords, famKey) === memberKey).length;

  const createFamily = () => {
    if (newFamily.trim().length < 2) return;
    store.addFamily(newFamily);
    setNewFamily("");
  };

  const createMember = (fam: ManualFamily) => {
    const label = (newMember[fam.id] ?? "").trim();
    if (!label) return;
    store.addMember(fam, label);
    setNewMember((prev) => ({ ...prev, [fam.id]: "" }));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Uma divisão reparte o mesmo número em partes — por exemplo “Canal”, com
        as opções Ligação e E-mail. Depois de criar, marque em quais métricas ela
        vale (aba Métricas).{" "}
        <HelpHint ariaLabel="Como as divisões funcionam">
          O total e as partes são leituras do MESMO número: total 1.000, Ligação
          600 e E-mail 400 continuam sendo 1.000. Nos gráficos, a divisão vira a
          dimensão (grupo “Divisões da Base manual”) ou um filtro; a ordem das
          opções é a ordem das barras.
        </HelpHint>
      </p>

      {canEdit ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            createFamily();
          }}
        >
          <Input
            aria-label={`Nova ${MANUAL_TERMS.division.toLowerCase()}`}
            className="h-9 w-72"
            placeholder="Nome da nova divisão (ex.: Canal)"
            value={newFamily}
            onChange={(ev) => setNewFamily(ev.target.value)}
          />
          <Button type="submit" size="sm" disabled={newFamily.trim().length < 2}>
            <Plus className="size-4" /> Criar divisão
          </Button>
        </form>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {families.map((fam, i) => {
          const temp = isTempId(fam.id);
          const opts = store.membersOf(fam.id);
          const users = usedBy(fam.key);
          const inUse = entriesUsing(fam.key);
          return (
            <section key={fam.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center gap-1">
                <InlineName
                  value={fam.label}
                  label={`Nome da divisão ${fam.label}`}
                  disabled={!canEdit || temp}
                  minLength={2}
                  className="h-8 flex-1 font-medium"
                  onCommit={(v) => store.renameFamily(fam, v)}
                />
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Ações da divisão ${fam.label}`}
                        disabled={temp}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={i === 0}
                        onSelect={() => store.moveFamily(fam.id, -1)}
                      >
                        Mover para cima
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === families.length - 1}
                        onSelect={() => store.moveFamily(fam.id, 1)}
                      >
                        Mover para baixo
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(fam)}>
                        Excluir divisão
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                {users.length > 0
                  ? `Usada por: ${users.join(", ")}`
                  : "Ainda não usada por nenhuma métrica."}
                {inUse > 0 ? ` · ${countLabel(inUse, "lançamento", "lançamentos")}` : ""}
              </p>

              <ul className="flex flex-col gap-1">
                {opts.length === 0 ? (
                  <li className="text-muted-foreground text-xs">Nenhuma opção ainda.</li>
                ) : null}
                {opts.map((m, j) => {
                  const mTemp = isTempId(m.id);
                  const mUse = entriesUsingMember(fam.key, m.key);
                  return (
                    <li key={m.id} className="flex items-center gap-1">
                      <InlineName
                        value={m.label}
                        label={`Nome da opção ${m.label}`}
                        disabled={!canEdit || mTemp}
                        minLength={1}
                        className="h-8 flex-1 text-sm"
                        onCommit={(v) => store.renameMember(m, v)}
                      />
                      {mUse > 0 ? (
                        <span
                          className="text-muted-foreground text-xs whitespace-nowrap"
                          title="Lançamentos que usam esta opção"
                        >
                          {countLabel(mUse, "lançamento", "lançamentos")}
                        </span>
                      ) : null}
                      {canEdit ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Subir ${m.label}`}
                            disabled={mTemp || j === 0}
                            onClick={() => store.moveMember(m, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Descer ${m.label}`}
                            disabled={mTemp || j === opts.length - 1}
                            onClick={() => store.moveMember(m, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="hover:text-destructive size-7"
                            aria-label={`Excluir ${m.label}`}
                            title={
                              mUse > 0
                                ? "Em uso: apague os lançamentos desta opção antes de excluí-la"
                                : undefined
                            }
                            disabled={mTemp}
                            onClick={() => store.deleteMember(m)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {canEdit && !temp ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    createMember(fam);
                  }}
                >
                  <Input
                    aria-label={`Nova opção em ${fam.label}`}
                    className="h-8 flex-1"
                    placeholder="Nova opção"
                    value={newMember[fam.id] ?? ""}
                    onChange={(ev) =>
                      setNewMember((prev) => ({ ...prev, [fam.id]: ev.target.value }))
                    }
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={!(newMember[fam.id] ?? "").trim()}
                  >
                    Adicionar
                  </Button>
                </form>
              ) : null}
            </section>
          );
        })}

        <section className="bg-muted/30 flex flex-col gap-2 rounded-md border border-dashed p-3">
          <p className="text-sm font-medium">Divisões do sistema</p>
          <p className="text-muted-foreground text-xs">
            Prontas para usar em qualquer métrica. As opções vêm do cadastro — não
            precisam ser criadas aqui — e o número lançado casa com os gráficos
            “por responsável” e “por operação” dos registros.
          </p>
          <ul className="flex flex-wrap gap-1">
            {BUILTIN_MANUAL_FAMILIES.map((f) => (
              <li key={f.key} className="rounded-full border px-2 py-0.5 text-xs">
                {f.label}
                {usedBy(f.key).length > 0 ? (
                  <span className="text-muted-foreground"> · {usedBy(f.key).join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ConfirmDialog
        open={confirm != null}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
        title={`Excluir a divisão “${confirm?.label ?? ""}”?`}
        description="As opções dela somem junto, e gráficos que a usam passam a exibir “—”. Se algum lançamento ainda usa esta divisão, a exclusão é recusada — apague esses lançamentos antes (ou só renomeie a divisão)."
        actionLabel="Excluir"
        destructive
        onConfirm={() => {
          const f = confirm;
          setConfirm(null);
          if (f) store.deleteFamily(f);
        }}
      />
    </div>
  );
}
