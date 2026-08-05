// Versão: 2.0 | Data: 05/08/2026
// Stub de redirect: Tarefas mora em /operacao/tarefas (card padrão de Operação
// no hub Workspace desde 05/08/2026). Mantém bookmarks funcionando.
import { redirect } from "next/navigation";

export default function TarefasRedirect() {
  redirect("/operacao/tarefas");
}
