// Versão: 1.0 | Data: 11/10/2026
// Registros → Novas bases de Sync (0155). Triagem dos PROCESSOS INTELIGENTES
// do Bitrix: ver cada processo pelo nome, avaliar uma amostra dos registros e
// das atividades, solicitar, ajustar e só então aprovar como Base. A lista do
// portal é buscada pelo cliente (action) para a página abrir na hora mesmo com
// o Bitrix lento.
import { requireRole } from "@/lib/auth/session";
import { requireSettingsArea } from "@/lib/auth/access";
import { BackLink } from "@/components/ui/back-link";
import { SyncBasesTriage } from "@/components/configuracoes/sync-bases-triage";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Novas bases de Sync" };

export default async function NovasBasesSyncPage() {
  await requireSettingsArea("fontes");
  await requireRole("admin");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Novas bases de Sync</h1>
          <p className="text-muted-foreground text-sm">
            Processos inteligentes (funis) do Bitrix que ainda não são Bases.
            Avalie uma amostra, solicite, ajuste os campos e aprove — só a
            aprovação cria a Base e começa a importar registros e atividades.
          </p>
        </div>
        <BackLink fallback="/registros" fallbackLabel="Registros" />
      </div>
      <SyncBasesTriage />
    </div>
  );
}
