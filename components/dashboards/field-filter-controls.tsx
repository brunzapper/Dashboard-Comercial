// Versão: 1.7 | Data: 04/09/2026
// v1.7 (04/09/2026): a gravação SOBREVIVE ao desmonte do card. A troca de aba
// do dashboard desmonta os widgets da aba anterior e o cleanup do debounce
// (350ms) matava o timer — o filtro recém-aplicado/limpo não chegava nem ao
// banco (modo compartilhado) nem à URL/preferência (modo URL). O payload
// pendente passa a viver em pendingRef e um effect MOUNT-ONLY o FLUSHA no
// desmonte (o cleanup do effect de debounce roda a cada mudança de `encoded`,
// então não serve de gancho de desmonte). No flush do branch de URL o replace
// vai DIRETO ao router, sem o `run` do useNavPending — acender o overlay de um
// componente que já morreu não faz sentido. Cache de módulo do valor otimista
// (modo compartilhado) evita o pisca do valor antigo ao voltar à aba antes do
// refresh de reconciliação (que também sobrevive — use-debounced-refresh v1.2).
// Runtime do widget "Filtro por campo" (visual_type 'filtro_campo'): caixa de
// busca + um controle por campo configurado. Grava o estado ({q, filters}) na
// URL sob `paramKey` (ff_<widgetId>) com debounce; o servidor aplica os filtros
// a todos os widgets de dados com fonte sobreposta (menos os desmarcados),
// recomputando-os. Espelha o padrão de URL do filtro de período.
// v1.1: persiste o estado por usuário (user_preferences.lastFieldFilters via
// saveLastFieldFilter, fire-and-forget no mesmo debounce) — a page reidrata
// quando a URL não traz o parâmetro; a URL sempre vence.
// v1.2: o primeiro sync de URL (seed savedValue sem parâmetro na URL) é RASO
// (history.replaceState, sem navegação RSC): o servidor já aplicou esse valor;
// navegar aqui recomputava o dashboard à toa e o overlay "Carregando…" da
// montagem ficava preso sob rajadas de router.refresh() do realtime. `run`/
// overlay + persistência só quando o usuário muda algo de fato.
// v1.3: entry.hiddenOptions oculta opções do dropdown/checklist (só exibição —
// visibleOptions com `keep` = valor selecionado; a decisão dropdown×texto segue
// pela lista CRUA, então "tudo oculto" nunca degrada para input livre).
// v1.4: prop `shared` (settings.valueScope 'all') — o valor vale para TODOS os
// usuários: transporte vira o BANCO (célula __ff__ via saveSharedFieldFilter,
// padrão QuickFiltersBar), a URL NÃO é escrita (um ff_ residual de bookmark é
// removido na primeira edição — senão o viewer ficaria pinado no valor do
// mount) e o estado ressincroniza do seed do servidor quando outro usuário
// muda o valor. Em snapshot, `shared` é ignorado (URL-only por visitante).
// v1.6 (01/09/2026): MULTI-SELEÇÃO automática — todo campo com opções cujo
// operador é "=" ou "em (lista)" vira um MultiSelectPopover (checkboxes,
// controle compartilhado com os filtros rápidos). O operador configurado
// deixa de decidir a forma do controle: com 2+ marcações o filtro emitido
// vira `in` sozinho; com 1 marcação num entry "=" segue `eq` (round-trip
// byte-idêntico ao que já estava gravado). Por isso o estado de um entry
// agora é string[] (multi) OU string (Input de texto, Combobox dos demais
// operadores e o "1" de is_null/not_null — todos inalterados).
// v1.5 (07/08/2026): o save do modo compartilhado roda OTIMISTA em background
// (useBackgroundSave, revalidate:false): os controles respondem na hora e o
// refresh debounced do hook reconcilia; erro → toast + revert de q/values ao
// último estado aplicado. O transition global segue SÓ no branch de URL
// (navegação real).
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { MultiSelectPopover } from "@/components/filters/multi-select-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AvailableField } from "@/lib/widgets/fields";
import { fieldLabel } from "@/lib/widgets/fields";
import type {
  FieldFilterEntry,
  FieldFilterOptions,
  FilterOp,
  WidgetFilter,
} from "@/lib/widgets/types";
import { opHasNoValue } from "@/lib/widgets/filter-ops";
import { visibleOptions } from "@/lib/widgets/hidden-options";
import { encodeViewFilter, parseViewFilter } from "@/lib/widgets/view-filters";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  saveLastFieldFilter,
  saveSharedFieldFilter,
} from "@/app/(app)/dashboards/actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import { useNavPending } from "./pending-context";

// Valor otimista do modo COMPARTILHADO por widget, vivo enquanto a página está
// aberta: a troca de aba desmonta o card e o remonta com as props RSC do último
// render, ainda antigas enquanto o refresh não aterrissa. `baseline` é o
// savedValue canônico no instante da escrita — a entrada é descartada assim que
// o servidor passa dele (nossa gravação chegou, ou outro usuário mudou), então
// nada fica pinado em valor stale. Mesmo padrão do exprCache do CalculatorWidget.
const sharedOptimisticCache = new Map<
  string,
  { encoded: string; baseline: string }
>();

// Valor local de um controle: ARRAY para os de multi-seleção, string para o
// resto (Input de texto, Combobox de um valor, "1" dos operadores sem valor).
type EntryValue = string | string[];

/**
 * A entrada vira multi-seleção? Só campo com dropdown de opções e operador de
 * igualdade — "=" (multi automática, v1.6) ou "em (lista)". Os demais
 * operadores (≠, contém, >, ≥, <, ≤) comparam com UM valor: `not_in` não
 * existe no vocabulário de filtros, então multi ali não teria como ser
 * traduzida. Régua ÚNICA — initialValues, buildFilters e o render usam esta.
 */
function isMultiEntry(
  entry: FieldFilterEntry,
  options?: FieldFilterOptions
): boolean {
  const op = entry.op ?? "eq";
  if (op !== "eq" && op !== "in") return false;
  return (options?.[entry.field]?.length ?? 0) > 0;
}

// Reconstrói os valores iniciais dos controles a partir dos filtros da URL,
// casando pelo campo+operador de cada entrada configurada. Entrada MULTI casa
// tanto `eq` quanto `in` (o mesmo controle emite os dois conforme a contagem):
// sem isso, um seed com `in` numa entrada configurada como `eq` não
// round-triparia e o widget navegaria/persistiria sozinho na montagem.
function initialValues(
  entries: FieldFilterEntry[],
  urlFilters: WidgetFilter[],
  options?: FieldFilterOptions
): EntryValue[] {
  return entries.map((entry) => {
    const op = entry.op ?? "eq";
    const multi = isMultiEntry(entry, options);
    const match = urlFilters.find((f) => {
      if (f.field !== entry.field) return false;
      const fop = f.op ?? "eq";
      return multi ? fop === "eq" || fop === "in" : fop === op;
    });
    if (!match) return multi ? [] : "";
    if (opHasNoValue(op)) return "1";
    if (multi) {
      if (Array.isArray(match.value))
        return match.value.map((v) => String(v)).filter(Boolean);
      const s = String(match.value ?? "").trim();
      return s ? [s] : [];
    }
    if (op === "in" && Array.isArray(match.value)) return match.value.join(",");
    return String(match.value ?? "");
  });
}

function buildFilters(
  entries: FieldFilterEntry[],
  values: EntryValue[]
): WidgetFilter[] {
  const out: WidgetFilter[] = [];
  entries.forEach((entry, i) => {
    const op = (entry.op ?? "eq") as FilterOp;
    const raw = values[i] ?? "";
    // Multi-seleção: 1 valor num entry "=" segue emitindo `eq` (o que já
    // estava gravado continua idêntico); 2+ (ou entry "em (lista)") vira `in`
    // com array. A ordem das chaves é {field, op, value} em todos os ramos —
    // encodeViewFilter é JSON.stringify e o compare com serverAppliedRef é
    // por STRING.
    if (Array.isArray(raw)) {
      const vals = raw.map((v) => v.trim()).filter(Boolean);
      if (vals.length === 0) return;
      if (op === "eq" && vals.length === 1) {
        out.push({ field: entry.field, op, value: vals[0] });
        return;
      }
      out.push({ field: entry.field, op: "in", value: vals });
      return;
    }
    if (opHasNoValue(op)) {
      if (raw === "1") out.push({ field: entry.field, op });
      return;
    }
    const v = raw.trim();
    if (!v) return;
    if (op === "in") {
      out.push({
        field: entry.field,
        op,
        value: v.split(",").map((s) => s.trim()).filter(Boolean),
      });
      return;
    }
    out.push({ field: entry.field, op, value: v });
  });
  return out;
}

export function FieldFilterControls({
  paramKey,
  fields,
  searchFields,
  available,
  options,
  savedValue,
  dashboardId,
  widgetId,
  shared,
}: {
  paramKey: string;
  fields: FieldFilterEntry[];
  searchFields?: string[];
  available: AvailableField[];
  // Opções de dropdown por campo (responsável/operação/etapa). Ausente = <Input>.
  options?: FieldFilterOptions;
  // Valor salvo do usuário (lastFieldFilters), usado como seed quando a URL
  // não traz o parâmetro — o servidor já aplicou este mesmo valor aos widgets;
  // o primeiro debounce sincroniza a URL. URL presente vence.
  savedValue?: string;
  // Presentes no dashboard autenticado: habilitam a persistência por usuário
  // (lastFieldFilters). O viewer público de snapshots não os passa (URL-only).
  dashboardId?: string;
  widgetId?: string;
  // settings.valueScope 'all': o valor é COMPARTILHADO entre usuários (célula
  // __ff__ de dashboard_table_cells) — ver header v1.4. Ignorado em snapshot.
  shared?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { run } = useNavPending();
  const { save } = useBackgroundSave();
  // Viewer de snapshot: filtros seguem funcionando via URL, mas NUNCA
  // persistem preferência (visitante pode nem ter sessão; e um usuário
  // autenticado vendo o snapshot não pode poluir o dashboard vivo).
  const { snapshot } = useSnapshotMode();

  // Modo compartilhado e seed canônico do servidor — declarados ANTES do estado
  // porque o cache de otimistas participa da semente da montagem.
  const sharedMode = Boolean(shared) && !snapshot;
  const canonSaved = encodeViewFilter(parseViewFilter(savedValue ?? null));
  const cacheKey = `${dashboardId ?? ""}:${widgetId ?? ""}`;
  const cachedShared = sharedMode
    ? sharedOptimisticCache.get(cacheKey)
    : undefined;
  // Entrada obsoleta: o servidor já passou do baseline dela. Descarta (idempotente).
  if (cachedShared && cachedShared.baseline !== canonSaved) {
    sharedOptimisticCache.delete(cacheKey);
  }
  // Otimista ainda não confirmado (remontagem por troca de aba): vence o seed do
  // servidor, que neste render ainda traz o valor ANTIGO. serverAppliedRef nasce
  // dele também, senão a montagem re-gravaria o mesmo valor.
  const pendingShared =
    cachedShared && cachedShared.baseline === canonSaved
      ? cachedShared.encoded
      : null;
  const initial = parseViewFilter(
    pendingShared ?? sp.get(paramKey) ?? savedValue ?? null
  );
  const [q, setQ] = useState(initial.q ?? "");
  const [values, setValues] = useState<EntryValue[]>(() =>
    initialValues(fields, initial.filters, options)
  );
  // Último estado que o SERVIDOR já aplicou, na forma canônica encode∘parse do
  // valor inicial bruto (URL ou seed — a page renderizou com ele). Enquanto
  // `encoded` for igual a ele, o debounce só espelha a URL (replaceState raso);
  // qualquer diferença — mudança do usuário, ou seed que não round-tripa numa
  // config antiga dos `fields` — navega de verdade e atualiza o ref.
  const serverAppliedRef = useRef(encodeViewFilter(initial));

  // Modo compartilhado: ressincroniza do seed do servidor quando OUTRO usuário
  // muda o valor (variação do padrão seedKey do app, em effect — o guard lê
  // refs, proibido em render). sharedSeedRef só reage a MUDANÇA do seed (mount
  // não reseta — um ff_ de bookmark segue honrado naquele render), e o compare
  // com o último valor aplicado localmente evita clobber do que o usuário
  // digita durante um debounce pendente e no eco do próprio save.
  const sharedSeedRef = useRef(canonSaved);
  useEffect(() => {
    if (!sharedMode || canonSaved === sharedSeedRef.current) return;
    sharedSeedRef.current = canonSaved;
    if (canonSaved !== serverAppliedRef.current) {
      serverAppliedRef.current = canonSaved;
      const parsed = parseViewFilter(savedValue ?? null);
      setQ(parsed.q ?? "");
      setValues(initialValues(fields, parsed.filters, options));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedMode, canonSaved]);

  const showSearch = (searchFields?.length ?? 0) > 0 || fields.length === 0;

  const encoded = encodeViewFilter({ q, filters: buildFilters(fields, values) });
  // Payload pendente do debounce. O timer o CONSOME; o effect mount-only abaixo
  // o FLUSHA no desmonte — a troca de aba desmonta o card e, sem isso, os 350ms
  // pendentes eram simplesmente descartados. O cleanup do effect de debounce NÃO
  // serve de gancho de desmonte: ele roda a cada mudança de `encoded`.
  const pendingRef = useRef<((viaUnmount?: boolean) => void) | null>(null);
  // Só o payload armado por uma mudança do USUÁRIO é flushado. O primeiro
  // disparo do effect de debounce acontece na MONTAGEM e pode armar um payload
  // de mera sincronização (seed que não round-tripa numa config antiga dos
  // campos); flushá-lo no desmonte gravaria sem ninguém ter mexido — e em dev o
  // StrictMode (monta → desmonta → monta) faria isso em toda montagem.
  const armedByUserRef = useRef(false);
  useEffect(
    () => () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (armedByUserRef.current) pending?.(true);
    },
    []
  );
  const firstEffectRunRef = useRef(true);
  useEffect(() => {
    const bySeed = firstEffectRunRef.current;
    firstEffectRunRef.current = false;
    // Modo compartilhado (não-snapshot): o transporte é o BANCO (célula
    // __ff__), nunca a URL — espelhá-la pinaria cada viewer no valor do mount
    // (a URL vence no servidor). A comparação de "nada mudou" é contra o
    // último valor aplicado, não contra a URL.
    if (sharedMode) {
      if (encoded === serverAppliedRef.current) {
        // Voltou ao valor já aplicado: um payload pendente de antes não pode
        // sobreviver ao desmonte gravando um valor que o usuário desfez.
        pendingRef.current = null;
        return;
      }
      const dispatch = () => {
        // ff_ residual (bookmark antigo): removido na primeira edição, para o
        // viewer convergir para a célula compartilhada nas próximas renders.
        const params = new URLSearchParams(window.location.search);
        if (params.has(paramKey)) {
          params.delete(paramKey);
          const qs = params.toString();
          window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
        }
        const prevApplied = serverAppliedRef.current;
        serverAppliedRef.current = encoded;
        if (dashboardId && widgetId) {
          // Sobrevive à remontagem por troca de aba até o servidor confirmar.
          sharedOptimisticCache.set(cacheKey, { encoded, baseline: canonSaved });
          // Save otimista em background (padrão QuickFiltersBar v1.3): os
          // controles já mostram o valor novo; a action volta logo após o
          // upsert (revalidate:false) e o refresh debounced reconcilia.
          // encoded vazio APAGA a célula (o usuário removeu o filtro — vale
          // para todos). Erro → toast + revert ao último estado aplicado.
          save({
            key: "ff",
            context: "Não foi possível salvar o filtro",
            action: () =>
              saveSharedFieldFilter(dashboardId, widgetId, encoded || null, {
                revalidate: false,
              }),
            revert: () => {
              // O otimista morreu: o cache não pode ressuscitá-lo na remontagem.
              sharedOptimisticCache.delete(cacheKey);
              serverAppliedRef.current = prevApplied;
              const parsed = parseViewFilter(prevApplied || null);
              setQ(parsed.q ?? "");
              setValues(initialValues(fields, parsed.filters, options));
            },
          });
        }
      };
      pendingRef.current = dispatch;
      armedByUserRef.current = !bySeed;
      const timer = setTimeout(() => {
        // Só o agendamento VIGENTE dispara (um `encoded` mais novo o substituiu).
        if (pendingRef.current !== dispatch) return;
        pendingRef.current = null;
        dispatch();
      }, 350);
      return () => clearTimeout(timer);
    }
    // URL lida de window.location (não do `sp` capturado): escrita de URL de
    // outro controle entre o agendamento e o disparo não é sobrescrita.
    const currentVal =
      new URLSearchParams(window.location.search).get(paramKey) ?? "";
    if (encoded === currentVal) {
      // Já está na URL: nada pendente pode sobreviver ao desmonte.
      pendingRef.current = null;
      return;
    }
    const dispatch = (viaUnmount = false) => {
      const params = new URLSearchParams(window.location.search);
      if (encoded) params.set(paramKey, encoded);
      else params.delete(paramKey);
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (encoded === serverAppliedRef.current) {
        // O servidor já renderizou com este valor — só sincroniza a URL, sem
        // recomputar o dashboard nem ligar o overlay, e sem persistir (o valor
        // veio da própria preferência/URL).
        window.history.replaceState(null, "", url);
        return;
      }
      serverAppliedRef.current = encoded;
      // No flush do desmonte o overlay não faz sentido (o componente já morreu)
      // — a navegação vai direto ao router.
      if (viaUnmount) router.replace(url, { scroll: false });
      else run(() => router.replace(url, { scroll: false }));
      // Persistência por usuário (fire-and-forget): encoded vazio LIMPA a
      // preferência (o usuário removeu o filtro — não pode ressuscitar).
      if (!snapshot && dashboardId && widgetId) {
        void saveLastFieldFilter(dashboardId, widgetId, encoded || null).catch(
          () => {
            // Preferência é best-effort: a falha não pode virar unhandled
            // rejection, e o filtro em tela já foi aplicado pela URL.
          }
        );
      }
    };
    pendingRef.current = dispatch;
    armedByUserRef.current = !bySeed;
    const timer = setTimeout(() => {
      // Só o agendamento VIGENTE dispara (um `encoded` mais novo o substituiu).
      if (pendingRef.current !== dispatch) return;
      pendingRef.current = null;
      dispatch();
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded]);

  const setValue = (i: number, v: EntryValue) =>
    setValues((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-1">
      {showSearch ? (
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar"
            className="h-8 pl-7 text-sm"
          />
        </div>
      ) : null}

      {fields.map((entry, i) => {
        const label = entry.label || fieldLabel(entry.field, available);
        const op = (entry.op ?? "eq") as FilterOp;
        const raw = values[i];
        if (opHasNoValue(op)) {
          return (
            <label key={i} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={raw === "1"}
                onCheckedChange={(c) => setValue(i, c ? "1" : "")}
              />
              {label} {op === "is_null" ? "(vazio)" : "(preenchido)"}
            </label>
          );
        }
        const opts = options?.[entry.field];
        // Campo com opções (responsável/operação/etapa/seleção) e operador de
        // igualdade: multi-seleção por checkbox — o MESMO popover dos filtros
        // rápidos. Os demais operadores (≠, contém, comparações) seguem com o
        // select de um valor.
        if (opts && opts.length > 0) {
          if (isMultiEntry(entry, options)) {
            // Defensivo: se as opções chegarem só num render posterior, o
            // estado do entry pode ter nascido como string (controle único).
            // Exibe como seleção de um item — buildFilters emite `eq` para
            // esse mesmo estado, então tela e filtro seguem de acordo.
            const chosen = Array.isArray(raw) ? raw : raw ? [raw] : [];
            // Opção oculta mas SELECIONADA continua na lista (keep) — sem isso
            // não daria para desmarcá-la.
            const shown = visibleOptions(opts, entry.hiddenOptions, chosen);
            return (
              <div key={i} className="flex flex-col gap-1">
                <Label className="text-xs">{label}</Label>
                <MultiSelectPopover
                  options={shown}
                  values={chosen}
                  onChange={(next) => setValue(i, next)}
                  className="w-full max-w-none justify-between text-sm"
                  emptyText="Nenhuma opção visível."
                  ariaLabel={label}
                />
              </div>
            );
          }
          const single = typeof raw === "string" ? raw : "";
          const shown = visibleOptions(
            opts,
            entry.hiddenOptions,
            single ? [single] : []
          );
          return (
            <div key={i} className="flex flex-col gap-1">
              <Label className="text-xs">{label}</Label>
              <Combobox
                options={[{ value: "", label: "— todos —" }, ...shown]}
                value={single}
                onValueChange={(v) => setValue(i, v)}
                placeholder="— todos —"
                className="h-8 text-sm"
                aria-label={label}
              />
            </div>
          );
        }
        return (
          <div key={i} className="flex flex-col gap-1">
            <Label className="text-xs">{label}</Label>
            <Input
              value={typeof raw === "string" ? raw : ""}
              onChange={(e) => setValue(i, e.target.value)}
              placeholder={op === "in" ? "valores separados por vírgula" : "valor"}
              aria-label={label}
              className="h-8 text-sm"
            />
          </div>
        );
      })}
    </div>
  );
}
