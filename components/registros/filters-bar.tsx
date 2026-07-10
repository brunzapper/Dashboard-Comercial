// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — o seletor "Tipo" saiu (virou aba de fonte); a
//   barra preserva o parâmetro `fonte` ao filtrar/limpar.
// Barra de filtros da listagem de registros. Reflete/atualiza a URL
// (searchParams) — o server refaz a query a cada mudança.
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OptionItem } from "@/lib/records/types";

export function FiltersBar({ responsibles }: { responsibles: OptionItem[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  const fonte = sp.get("fonte") ?? "";
  const [etapa, setEtapa] = useState(sp.get("etapa") ?? "");
  const [responsavel, setResponsavel] = useState(sp.get("responsavel") ?? "");
  const [de, setDe] = useState(sp.get("de") ?? "");
  const [ate, setAte] = useState(sp.get("ate") ?? "");
  const [busca, setBusca] = useState(sp.get("busca") ?? "");

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (fonte) params.set("fonte", fonte);
    if (etapa) params.set("etapa", etapa);
    if (responsavel) params.set("responsavel", responsavel);
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (busca) params.set("busca", busca);
    router.push(`/registros?${params.toString()}`);
  }

  function clear() {
    setEtapa("");
    setResponsavel("");
    setDe("");
    setAte("");
    setBusca("");
    router.push(fonte ? `/registros?fonte=${fonte}` : "/registros");
  }

  return (
    <form
      onSubmit={apply}
      className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label>Responsável</Label>
        <Combobox
          options={[
            { value: "", label: "Todos" },
            ...responsibles.map((r) => ({ value: r.id, label: r.label })),
          ]}
          value={responsavel}
          onValueChange={setResponsavel}
          placeholder="Todos"
          className="w-full"
          aria-label="Responsável"
        />
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
