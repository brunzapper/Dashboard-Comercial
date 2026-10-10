// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Loading UI do segmento autenticado (app). Cobre TODAS as páginas filhas: numa
// navegação pelo menu lateral (layout já montado), só a página troca e este
// fallback aparece na hora — elimina o "trava e nada acontece" ao clicar.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="grid" label="Carregando" search rows={6} />;
}
