// Versão: 1.3 | Data: 10/10/2026
// v1.3 (10/10/2026): filtro "Tem tarefa" (estado + dias atrás/à frente) —
//   parâmetros `tarefa`/`t_atras`/`t_frente`, editor compartilhado
//   (components/filters/task-filter-editor.tsx).
// v1.2 (07/08/2026): filtrar preserva a ordenação ativa (`ordenar`/`dir` da
//   URL são re-emitidos no apply; a página já volta a 1 porque `page` não é
//   re-emitido). "Limpar" segue zerando tudo — ordenação inclusa, de projeto.
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
import {
  TaskFilterEditor,
  type TaskFilterDraft,
} from "@/components/filters/task-filter-editor";
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
  // v1.3: filtro "Tem tarefa" (a página valida os valores no servidor).
  const [tarefa, setTarefa] = useState<TaskFilterDraft>({
    status: (sp.get("tarefa") ?? "") as TaskFilterDraft["status"],
    back: sp.get("t_atras") ?? "",
    ahead: sp.get("t_frente") ?? "",
  });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (fonte) params.set("fonte", fonte);
    if (etapa) params.set("etapa", etapa);
    if (responsavel) params.set("responsavel", responsavel);
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (busca) params.set("busca", busca);
    if (tarefa.status) {
      params.set("tarefa", tarefa.status);
      if (tarefa.back.trim()) params.set("t_atras", tarefa.back.trim());
      if (tarefa.ahead.trim()) params.set("t_frente", tarefa.ahead.trim());
    }
    // Ordenação ativa sobrevive ao filtrar (o server re-valida os valores).
    const ordenar = sp.get("ordenar");
    const dir = sp.get("dir");
    if (ordenar) params.set("ordenar", ordenar);
    if (dir) params.set("dir", dir);
    router.push(`/registros?${params.toString()}`);
  }

  function clear() {
    setEtapa("");
    setResponsavel("");
    setDe("");
    setAte("");
    setBusca("");
    setTarefa({ status: "", back: "", ahead: "" });
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

      <div className="flex flex-col gap-1.5">
        <Label>Tem tarefa</Label>
        <TaskFilterEditor value={tarefa} onChange={setTarefa} allowNone />
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
