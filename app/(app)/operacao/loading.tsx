// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Loading das sub-abas de /operacao (nível do layout): as abas em si vêm do
// layout (ficam visíveis); o skeleton cobre só o corpo. Agenda/Tarefas têm
// loading próprio no segmento, que prevalece; este cobre Remuneração.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="grid" label="Carregando operação" rows={6} />;
}
