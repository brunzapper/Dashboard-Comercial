// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Esqueleto de /operacao/workflow — espelha o formulário (título + campos).
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="form" label="Carregando workflow" rows={7} />;
}
