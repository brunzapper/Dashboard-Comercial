// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Loading de /campos: header + abas + tabela do catálogo.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="list" label="Carregando campos" actions={3} tableHeader rows={8} rowClassName="h-11" />;
}
