// Versão: 1.1 | Data: 25/07/2026
// v1.1 (25/07/2026): AddPageDialog aceita onMerge (performMerge do grid) —
//   confirmar fecha na hora e a mescla aparece otimista; sem a prop, cai na
//   action direta com erro no diálogo.
// UI das PÁGINAS de widget (mescla — lib/widgets/pages.ts):
//  * WidgetPager — pílula flutuante acima do card do host (‹ 1/2 ›) que
//    alterna a página exibida. Visível em visualização, edição E no viewer de
//    snapshot (estado efêmero no grid — nada persiste).
//  * MergePromptDialog — confirmação do drop "quase em cima" (dashboard-grid):
//    Confirmar mescla; Cancelar DESFAZ o arraste (decisão de produto).
//  * AddPageDialog — ⋮ → "Adicionar página": Combobox com os widgets
//    ELEGÍVEIS da aba atual (canBePage; nunca hosts/membros/o próprio).
//  * UnmergeDialog — ⋮ → "Desfazer mescla": devolve TODOS os membros ao
//    canvas (unmergeWidgetPages reposiciona via findFreePosition).
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Combobox } from "@/components/ui/combobox";
import type { Widget } from "@/lib/widgets/types";
import { VISUAL_TYPE_LABELS } from "@/lib/widgets/types";
import {
  canBePage,
  collectPageMembers,
  isPageHost,
} from "@/lib/widgets/pages";
import {
  mergeWidgetPages,
  unmergeWidgetPages,
} from "@/app/(app)/dashboards/actions";

function widgetLabel(w: Widget): string {
  const type = VISUAL_TYPE_LABELS[w.visual_type] ?? w.visual_type;
  return `${w.title?.trim() || "Sem título"} (${type})`;
}

// Pílula ‹ 1/2 › acima do card. `inset` = host encostado no topo do canvas
// (y = 0): a pílula entra PARA DENTRO do card — o container do grid tem
// overflow-y-hidden e cortaria a versão flutuante.
export function WidgetPager({
  count,
  index,
  inset,
  onChange,
}: {
  count: number;
  index: number;
  inset: boolean;
  onChange: (index: number) => void;
}) {
  if (count <= 1) return null;
  return (
    <div
      className={cn(
        "absolute left-1/2 z-30 -translate-x-1/2",
        inset ? "top-1" : "-top-6"
      )}
      // Não deixa o gesto virar pan/drag do canvas (a pílula não é
      // .widget-drag, mas o pointerdown subiria até o container).
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="bg-background/95 text-muted-foreground flex items-center gap-0.5 rounded-full border px-1 py-0.5 text-xs shadow-sm backdrop-blur-sm">
        <button
          type="button"
          aria-label="Página anterior"
          onClick={() => onChange((index - 1 + count) % count)}
          className="hover:bg-accent hover:text-accent-foreground rounded-full p-0.5"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="px-0.5 tabular-nums">
          {index + 1}/{count}
        </span>
        <button
          type="button"
          aria-label="Próxima página"
          onClick={() => onChange((index + 1) % count)}
          className="hover:bg-accent hover:text-accent-foreground rounded-full p-0.5"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// Diálogo do drop quase-em-cima. Controlado pelo grid: Confirmar chama
// onConfirm (que mescla e depois fecha limpando o estado); Cancelar/Esc/
// clique-fora caem no onCancel (o grid desfaz o arraste — nada persiste).
export function MergePromptDialog({
  open,
  pending,
  draggedTitle,
  hostTitle,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  draggedTitle: string;
  hostTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Adicionar página?</AlertDialogTitle>
          <AlertDialogDescription>
            {`"${draggedTitle}" vira uma página de "${hostTitle}" — os dois
            passam a dividir o mesmo espaço e as setinhas acima do card
            alternam entre eles. Cancelar desfaz o arraste.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "Mesclando…" : "Adicionar página"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ⋮ → "Adicionar página": escolhe um widget ELEGÍVEL da aba atual para virar a
// próxima página do host. `siblings` já são os widgets da aba (o shell filtra
// por aba antes do grid); excluímos o host, o exibido, inelegíveis, hosts com
// páginas próprias e quem já é membro de alguém. Com `onMerge` (performMerge
// do grid) a mescla é OTIMISTA: confirmar fecha na hora e o efeito aparece
// imediatamente (falha faz rollback no grid); sem a prop, cai na action
// direta com erro exibido no diálogo.
export function AddPageDialog({
  open,
  onOpenChange,
  dashboardId,
  hostId,
  hostTitle,
  siblings,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  hostId: string;
  hostTitle: string;
  siblings: Widget[];
  onMerge?: (
    hostId: string,
    memberIds: string[]
  ) => Promise<{ ok?: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);

  const memberIds = collectPageMembers(siblings);
  const options = siblings
    .filter(
      (s) =>
        s.id !== hostId &&
        canBePage(s) &&
        !isPageHost(s) &&
        !memberIds.has(s.id)
    )
    .map((s) => ({ value: s.id, label: widgetLabel(s) }));

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPicked("");
          setError(null);
        }
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Adicionar página</AlertDialogTitle>
          <AlertDialogDescription>
            {`Escolha um widget desta aba para virar a próxima página de
            "${hostTitle}". Ele sai do canvas e passa a dividir este espaço
            (as setinhas alternam).`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {options.length > 0 ? (
          <Combobox
            options={options}
            value={picked}
            onValueChange={setPicked}
            placeholder="Escolher widget…"
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Nenhum widget elegível nesta aba (filtros, formas e imagens não
            podem virar página).
          </p>
        )}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || !picked}
            onClick={(e) => {
              e.preventDefault();
              setError(null);
              if (onMerge) {
                const chosen = picked;
                setPicked("");
                onOpenChange(false);
                startTransition(async () => {
                  await onMerge(hostId, [chosen]);
                });
                return;
              }
              startTransition(async () => {
                const res = await mergeWidgetPages(dashboardId, hostId, [
                  picked,
                ]);
                if (!res.ok) {
                  setError(res.message ?? "Falha ao mesclar.");
                  return;
                }
                setPicked("");
                onOpenChange(false);
                router.refresh();
              });
            }}
          >
            {pending ? "Adicionando…" : "Adicionar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ⋮ → "Desfazer mescla": devolve TODOS os membros ao canvas (posição livre na
// aba do host — unmergeWidgetPages/findFreePosition).
export function UnmergeDialog({
  open,
  onOpenChange,
  dashboardId,
  hostId,
  hostTitle,
  pageCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  hostId: string;
  hostTitle: string;
  pageCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desfazer mescla?</AlertDialogTitle>
          <AlertDialogDescription>
            {`As ${pageCount} páginas de "${hostTitle}" voltam a ser widgets
            separados — cada um reaparece em um espaço livre da aba.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const res = await unmergeWidgetPages(dashboardId, hostId);
                if (!res.ok) {
                  setError(res.message ?? "Falha ao desfazer a mescla.");
                  return;
                }
                onOpenChange(false);
                router.refresh();
              });
            }}
          >
            {pending ? "Desfazendo…" : "Desfazer mescla"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
