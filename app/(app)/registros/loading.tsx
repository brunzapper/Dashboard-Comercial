// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): sem o pr-8 do cabeçalho (o sino foi para a barra de
//   local) e o desenho saiu para o PageSkeleton compartilhado.
// Loading de /registros (e sub-rotas bases/log/importar, como boundary mais
// próximo): header + barra de filtros + tabela. A query paginada + FK labels
// tornam esta uma das rotas mais lentas do app.
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <PageSkeleton variant="list" label="Carregando registros" actions={3} search tableHeader rows={10} rowClassName="h-11" />;
}
