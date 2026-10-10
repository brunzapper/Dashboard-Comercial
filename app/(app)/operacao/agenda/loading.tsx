// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Loading da Agenda do workspace: toolbar + grade de calendário.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="calendar" label="Carregando agenda" actions={2} />;
}
