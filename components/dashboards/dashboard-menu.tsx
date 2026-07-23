// Versão: 1.1 | Data: 23/07/2026
// Fase 10: menu "⋮" ao lado de "Adicionar widget". Hoje: modo tela cheia
// (Fullscreen API + esconde o chrome, via AppChromeContext) e "Aparência do
// dashboard" (cor de fundo sólida/gradiente). Estruturado p/ novas opções.
// v1.1 (23/07/2026): item "Bases" (escopo de bases do board —
//   BoardSourcesDialog, mesmo dialog do kebab do hub) e "Compartilhamento" →
//   "Acesso" (BoardAccessDialog: funções + pessoas com Ver/Editar/Bloqueado;
//   o Sheet local de visible_to_roles foi absorvido pelo dialog).
"use client";

import { useState, useTransition } from "react";
import {
  Camera,
  Database,
  LayoutGrid,
  Maximize,
  MoreVertical,
  Palette,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAppChrome } from "@/components/layout/app-shell";
import { ColorField } from "./appearance-controls";
import { dashboardBackgroundCss } from "@/lib/widgets/appearance";
import type { DashboardSettings } from "@/lib/widgets/types";
import {
  DATE_FORMATS,
  DATE_FORMAT_LABELS,
  DEFAULT_DATE_FORMAT,
  type DateFormat,
} from "@/lib/widgets/format";
import { updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { SnapshotsPanel, type SnapshotPeriodCapture } from "./snapshots-panel";
import { BoardSourcesDialog } from "./board-sources-dialog";
import { BoardAccessDialog } from "./board-access-dialog";

type BgMode = "none" | "solid" | "gradient";

export function DashboardMenu({
  dashboardId,
  settings,
  snapshotPeriod,
}: {
  dashboardId: string;
  settings: DashboardSettings;
  // Contexto do período do dashboard (0059): captura do período congelado na
  // criação de snapshots.
  snapshotPeriod?: SnapshotPeriodCapture;
}) {
  const { toggleFullscreen } = useAppChrome();
  const [bgOpen, setBgOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Área de trabalho (grid): nº de colunas e altura da linha + largura/altura da área.
  const canvas = settings.canvas ?? {};
  const [cols, setCols] = useState<number>(canvas.cols ?? 12);
  const [rowHeight, setRowHeight] = useState<number>(canvas.rowHeight ?? 30);
  function saveCanvas() {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        ...settings,
        canvas: {
          ...settings.canvas,
          cols: Math.min(48, Math.max(1, Math.round(cols) || 12)),
          rowHeight: Math.min(200, Math.max(10, Math.round(rowHeight) || 30)),
        },
      });
      setCanvasOpen(false);
    });
  }

  const bg = settings.background;
  const [mode, setMode] = useState<BgMode>(bg?.mode ?? "none");
  const [solid, setSolid] = useState(bg?.color ?? "#0b1220");
  const [from, setFrom] = useState(bg?.from ?? "#0b1220");
  const [to, setTo] = useState(bg?.to ?? "#1e293b");
  const [angle, setAngle] = useState(bg?.angle ?? 135);
  const [dateFmt, setDateFmt] = useState<DateFormat>(
    settings.dateFormat ?? DEFAULT_DATE_FORMAT
  );
  // Escala de fonte do dashboard (1 = 100%; guardada como string p/ o Select).
  const [fontScale, setFontScale] = useState<string>(
    String(settings.fontScale ?? 1)
  );

  function save() {
    const nextBg: DashboardSettings["background"] | undefined =
      mode === "none"
        ? undefined
        : mode === "solid"
          ? { mode: "solid", color: solid }
          : { mode: "gradient", from, to, angle };
    const nextScale = Number(fontScale);
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        ...settings,
        background: nextBg,
        dateFormat: dateFmt,
        fontScale:
          Number.isFinite(nextScale) && nextScale !== 1 ? nextScale : undefined,
      });
      setBgOpen(false);
    });
  }

  const preview =
    mode === "none"
      ? undefined
      : dashboardBackgroundCss(
          mode === "solid"
            ? { mode: "solid", color: solid }
            : { mode: "gradient", from, to, angle }
        );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Mais opções">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => toggleFullscreen()}>
            <Maximize className="size-4" /> Modo tela cheia
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setBgOpen(true);
            }}
          >
            <Palette className="size-4" /> Aparência do dashboard
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCanvasOpen(true);
            }}
          >
            <LayoutGrid className="size-4" /> Área de trabalho
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setSourcesOpen(true);
            }}
          >
            <Database className="size-4" /> Bases
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setShareOpen(true);
            }}
          >
            <Users className="size-4" /> Acesso
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setSnapshotsOpen(true);
            }}
          >
            <Camera className="size-4" /> Snapshots
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Editor de fundo num Sheet (painel lateral) — robusto, não some ao
          mover o mouse como o Popover ancorado anterior. */}
      <Sheet open={bgOpen} onOpenChange={setBgOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Aparência do dashboard</SheetTitle>
            <SheetDescription>Fundo da área do dashboard.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-8">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Fundo</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as BgMode)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Padrão (tema)</SelectItem>
                  <SelectItem value="solid">Cor sólida</SelectItem>
                  <SelectItem value="gradient">Gradiente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "solid" ? (
              <ColorField label="Cor" value={solid} onChange={setSolid} />
            ) : null}

            {mode === "gradient" ? (
              <>
                <ColorField label="De" value={from} onChange={setFrom} />
                <ColorField label="Até" value={to} onChange={setTo} />
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Ângulo: {angle}°</Label>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={angle}
                    onChange={(e) => setAngle(Number(e.target.value))}
                  />
                </div>
              </>
            ) : null}

            {preview ? (
              <div
                className="h-10 rounded-md border"
                style={{ background: preview }}
              />
            ) : null}

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Formato de data padrão</Label>
              <Select
                value={dateFmt}
                onValueChange={(v) => setDateFmt(v as DateFormat)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {DATE_FORMAT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Aplicado a todas as datas das tabelas. Cada coluna pode
                sobrescrever (duplo-clique no cabeçalho na edição de layout).
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Escala da fonte</Label>
              <Select value={fontScale} onValueChange={setFontScale}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.9">90%</SelectItem>
                  <SelectItem value="1">100% (padrão)</SelectItem>
                  <SelectItem value="1.15">115%</SelectItem>
                  <SelectItem value="1.3">130%</SelectItem>
                  <SelectItem value="1.5">150%</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Multiplica o tamanho dos textos de todos os widgets. Ajustes em
                px por widget (Aparência ▸ Texto) não são afetados.
              </p>
            </div>

            <Button size="sm" onClick={save} disabled={pending}>
              Aplicar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Bases: escopo de bases do board (settings.sourceScope). */}
      <BoardSourcesDialog
        boardId={dashboardId}
        kanban={false}
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
      />

      {/* Acesso: funções (visible_to_roles) + pessoas (board_access, 0088). */}
      <BoardAccessDialog
        boardId={dashboardId}
        kanban={false}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {/* Snapshots: links públicos congelados de uma aba (sem login). O painel
          carrega a lista/opções ao abrir; o link aparece só na criação. */}
      <Sheet open={snapshotsOpen} onOpenChange={setSnapshotsOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Snapshots</SheetTitle>
            <SheetDescription>
              Acesso público (sem login) aos resultados de uma aba, com dados
              congelados e restrições de visibilidade.
            </SheetDescription>
          </SheetHeader>
          {snapshotsOpen ? (
            <SnapshotsPanel dashboardId={dashboardId} period={snapshotPeriod} />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Área de trabalho: densidade do grid (colunas + altura da linha). A
          largura/altura da área é ajustada arrastando a alça no modo edição. */}
      <Sheet open={canvasOpen} onOpenChange={setCanvasOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Área de trabalho</SheetTitle>
            <SheetDescription>
              Densidade do grid. Arraste a alça no canto (modo edição) para mudar o
              tamanho da área.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-8">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Colunas do grid: {cols}</Label>
              <input
                type="range"
                min={1}
                max={48}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Altura da linha (px)</Label>
              <Input
                type="number"
                min={10}
                max={200}
                value={rowHeight}
                onChange={(e) => setRowHeight(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <Button size="sm" onClick={saveCanvas} disabled={pending}>
              Aplicar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
