// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): ESQUELETO DE PÁGINA compartilhado pelos loading.tsx.
//   Cada um repetia à mão o mesmo desenho (título, barra, N linhas com atraso
//   escalonado) — dois ainda com `bg-muted animate-pulse` escrito direto.
//   As variantes cobrem as formas que existem: lista (com ou sem cabeçalho de
//   tabela), grade de cards, dashboard, formulário e calendário. Usa o
//   Skeleton do shadcn; o atraso de 60ms por item faz a onda que já existia.
import { Skeleton } from "@/components/ui/skeleton";

type Variant = "list" | "grid" | "dashboard" | "form" | "calendar";

const delay = (i: number, step = 60) => ({ animationDelay: `${i * step}ms` });

export function PageSkeleton({
  variant,
  label,
  rows = 8,
  rowClassName = "h-12",
  search = false,
  actions = 0,
  tableHeader = false,
}: {
  variant: Variant;
  /** Texto do aria-label ("Carregando tarefas"). */
  label: string;
  /** Linhas (lista), cards (grade) ou campos (formulário). */
  rows?: number;
  /** Altura das linhas da lista. */
  rowClassName?: string;
  /** Barra de busca/filtro sob o título. */
  search?: boolean;
  /** Botões à direita do título. */
  actions?: number;
  /** Linha de cabeçalho de tabela antes das linhas. */
  tableHeader?: boolean;
}) {
  const title = (
    <div className="flex items-center gap-2">
      <Skeleton className="h-8 w-48" />
      {actions > 0 ? (
        <div className="ml-auto flex gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );

  let body: React.ReactNode;
  switch (variant) {
    case "grid":
      body = (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" style={delay(i)} />
          ))}
        </div>
      );
      break;
    case "dashboard":
      body = (
        <>
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton key={i} className="h-60 rounded-lg" style={delay(i, 80)} />
            ))}
          </div>
        </>
      );
      break;
    case "form":
      body = (
        <div className="flex max-w-2xl flex-col gap-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-28" />
        </div>
      );
      break;
    case "calendar":
      body = (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={`h${i}`} className="h-6 w-full" />
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" style={delay(i % 7)} />
          ))}
        </div>
      );
      break;
    default:
      body = (
        <div className="flex flex-col gap-2">
          {tableHeader ? <Skeleton className="h-9 w-full" /> : null}
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton
              key={i}
              className={`${rowClassName} w-full`}
              style={delay(i)}
            />
          ))}
        </div>
      );
  }

  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={label}>
      {title}
      {search ? <Skeleton className="h-9 w-full max-w-md" /> : null}
      {body}
    </div>
  );
}
