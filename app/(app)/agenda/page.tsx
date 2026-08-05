// Versão: 2.0 | Data: 05/08/2026
// Stub de redirect: a Agenda mora em /operacao/agenda (card padrão de Operação
// no hub Workspace desde 05/08/2026). Mantém bookmarks e o lastView legado
// "/agenda" funcionando (validateLastView da Home também migra o valor na
// leitura — este stub cobre o acesso direto).
import { redirect } from "next/navigation";

export default function AgendaRedirect() {
  redirect("/operacao/agenda");
}
