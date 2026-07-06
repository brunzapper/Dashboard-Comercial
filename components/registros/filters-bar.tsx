// Versão: 1.0 | Data: 05/07/2026
// Barra de filtros da listagem de registros. Reflete/atualiza a URL
// (searchParams) — o server refaz a query a cada mudança.
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RECORD_TYPE_LABELS, type OptionItem } from "@/lib/records/types";

const selectClass =
  "border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function FiltersBar({ responsibles }: { responsibles: OptionItem[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [tipo, setTipo] = useState(sp.get("tipo") ?? "");
  const [etapa, setEtapa] = useState(sp.get("etapa") ?? "");
  const [responsavel, setResponsavel] = useState(sp.get("responsavel") ?? "");
  const [de, setDe] = useState(sp.get("de") ?? "");
  const [ate, setAte] = useState(sp.get("ate") ?? "");
  const [busca, setBusca] = useState(sp.get("busca") ?? "");

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (tipo) params.set("tipo", tipo);
    if (etapa) params.set("etapa", etapa);
    if (responsavel) params.set("responsavel", responsavel);
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (busca) params.set("busca", busca);
    router.push(`/registros?${params.toString()}`);
  }

  function clear() {
    setTipo("");
    setEtapa("");
    setResponsavel("");
    setDe("");
    setAte("");
    setBusca("");
    router.push("/registros");
  }

  return (
    <form
      onSubmit={apply}
      className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label>Tipo</Label>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className={selectClass}
        >
          <option value="">Todos</option>
          {(Object.keys(RECORD_TYPE_LABELS) as (keyof typeof RECORD_TYPE_LABELS)[]).map(
            (t) => (
              <option key={t} value={t}>
                {RECORD_TYPE_LABELS[t]}
              </option>
            )
          )}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Responsável</Label>
        <select
          value={responsavel}
          onChange={(e) => setResponsavel(e.target.value)}
          className={selectClass}
        >
          <option value="">Todos</option>
          {responsibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="etapa">Etapa contém</Label>
        <Input
          id="etapa"
          value={etapa}
          onChange={(e) => setEtapa(e.target.value)}
          placeholder="Ex.: Contrato"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="de">Criado de</Label>
        <Input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ate">Criado até</Label>
        <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="busca">Buscar (título)</Label>
        <Input
          id="busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome do cliente/negócio"
        />
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit">Filtrar</Button>
        <Button type="button" variant="outline" onClick={clear}>
          Limpar
        </Button>
      </div>
    </form>
  );
}
