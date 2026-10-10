// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Loading UI específica de um dashboard: cabeçalho + barra de período + grid de
// widgets em skeleton, para a navegação até o dashboard dar feedback imediato
// enquanto os widgets são computados no servidor.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="dashboard" label="Carregando dashboard" actions={1} rows={4} />;
}
