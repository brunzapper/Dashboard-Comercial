// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): o desenho do esqueleto saiu daqui para o PageSkeleton
//   compartilhado (components/ui/page-skeleton.tsx).
// Loading das abas de Configurações (nível do layout do hub): as abas em si
// vêm do layout (ficam visíveis); o skeleton cobre só o corpo da aba.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="list" label="Carregando configurações" rows={6} />;
}
