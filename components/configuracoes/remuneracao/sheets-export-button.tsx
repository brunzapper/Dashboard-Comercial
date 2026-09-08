// Versão: 1.1 | Data: 16/08/2026
// v1.1: payload v3 — além do demonstrativo, o clique manda o ROSTER de
// colaboradores (`getMembers`, casado por rótulo com o `detailTabs` que o
// builder calculou) e os `links` por linha; o SERVIDOR monta as abas
// Det-<Nome> (os registros não existem no cliente). O botão saiu da tela do
// vendedor — este componente é agora exclusivo da Visão geral (admin), então
// a prop `admin` foi removida e o popover de configuração é incondicional.
// Versão: 1.0 | Data: 02/08/2026
// Botão "Google Planilhas" da Visão geral. O clique cria um ticket single-use
// (createSheetExportTicket) e abre o Web App do Apps Script numa aba nova,
// que grava a planilha NA CONTA GOOGLE do próprio usuário. À prova de popup
// blocker: window.open("", "_blank") SÍNCRONO no gesto; o redirect entra
// depois que a action responde. Config (URL /exec do Web App, por org em
// sync_config) em Popover — só admin vê o "Configurar…"; vendedor sem config
// não vê nada. Payload derivado NO CLIQUE via compSheetReport (demonstrativo
// v2 — resumo + detalhe + kinds por linha, números crus p/ o Sheets) a partir
// dos MESMOS statements do CSV.
"use client";

import { Settings2, Sheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createSheetExportTicket,
  saveCompSheetsWebappUrl,
} from "@/app/(app)/operacao/remuneracao/sheets-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SHEET_TITLES,
  type CompSheetScope,
} from "@/lib/comp/sheets-export";
import { MONTH_LABELS } from "@/lib/date/month-labels";
import type { CompStatementInput } from "@/lib/export/comp";
import { compSheetReport } from "@/lib/export/comp-sheet";
import { notifyActionError, notifyOnError } from "@/lib/feedback/notify";

export interface SheetsExportButtonProps {
  scope: CompSheetScope;
  year: number;
  month: number;
  configured: boolean;
  webappUrl?: string | null; // default do input
  getStatements: () => CompStatementInput[]; // lazy — deriva no clique
  // Roster id↔rótulo dos colaboradores; casado por RÓTULO com o `detailTabs`
  // do builder p/ o servidor montar as abas de detalhamento.
  getMembers: () => { id: string; label: string }[];
}

function ConfigPopover(props: {
  webappUrl: string | null | undefined;
  triggerLabel: string | null; // null = ícone só (engrenagem)
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(props.webappUrl ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await notifyOnError(
      saveCompSheetsWebappUrl(value),
      "Não foi possível salvar a configuração"
    );
    setSaving(false);
    if (res?.ok) {
      setOpen(false);
      router.refresh();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(props.webappUrl ?? "");
      }}
    >
      <PopoverTrigger asChild>
        {props.triggerLabel != null ? (
          <Button type="button" variant="outline" size="sm">
            <Sheet className="size-4" /> {props.triggerLabel}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Configurar exportação para Google Planilhas"
            title="Configurar exportação para Google Planilhas"
          >
            <Settings2 className="size-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="comp-sheets-url">URL do Web App (Apps Script)</Label>
          <Input
            id="comp-sheets-url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
          />
          <p className="text-muted-foreground text-xs">
            Publique o Web App de integrations/apps-script/
            comp_sheets_webapp.gs (instruções no cabeçalho do arquivo) e cole
            aqui a URL /exec. Deixe vazio e salve para desativar.
          </p>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={saving} onClick={save}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SheetsExportButton(props: SheetsExportButtonProps) {
  const [pending, setPending] = useState(false);

  if (!props.configured) {
    return (
      <ConfigPopover
        webappUrl={props.webappUrl}
        triggerLabel="Google Planilhas — Configurar…"
      />
    );
  }

  const onExport = async () => {
    // ANTES de qualquer await (senão o popup blocker come a aba nova).
    const w = window.open("", "_blank");
    setPending(true);
    try {
      // year/month alimentam o bloco de contexto (mês APURADO via apuracaoRef);
      // sem eles o builder omite a linha em vez de inventá-la.
      const { headers, rows, kinds, links, detailTabs } = compSheetReport(
        props.getStatements(),
        {
          monthLabel: `${MONTH_LABELS[props.month - 1]} de ${props.year}`,
          year: props.year,
          month: props.month,
        }
      );
      // O builder ordena/nomeia as abas; o roster só empresta os ids. Rótulo
      // sem id (roster fora de sincronia) fica sem aba — nunca vira id vazio.
      const idByLabel = new Map(props.getMembers().map((m) => [m.label, m.id]));
      const members = detailTabs.flatMap((d) => {
        const id = idByLabel.get(d.label);
        return id ? [{ id, label: d.label, tabName: d.tabName }] : [];
      });
      const res = await notifyOnError(
        createSheetExportTicket({
          scope: props.scope,
          year: props.year,
          month: props.month,
          title: SHEET_TITLES[props.scope],
          tabName: `${MONTH_LABELS[props.month - 1]} ${props.year}`,
          headers,
          rows,
          kinds,
          links,
          members,
        }),
        "Não foi possível exportar para o Google Planilhas"
      );
      if (!res?.ok || !res.token || !res.webappUrl) {
        w?.close();
        return;
      }
      // Sucesso PARCIAL: a planilha do mês sai, mas sem as abas de
      // detalhamento. Sucesso é silencioso por política — este aviso é a
      // exceção, porque o usuário pediu um anexo que não veio.
      if (res.message) notifyActionError("Exportação parcial", res.message);
      const dest = `${res.webappUrl}?token=${encodeURIComponent(res.token)}`;
      if (w) w.location.href = dest;
      else window.open(dest, "_blank");
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        title="Cria/atualiza a planilha na sua conta Google — abre em nova aba."
        onClick={onExport}
      >
        <Sheet className="size-4" />
        {pending ? "Exportando…" : "Google Planilhas"}
      </Button>
      <ConfigPopover webappUrl={props.webappUrl} triggerLabel={null} />
    </span>
  );
}
