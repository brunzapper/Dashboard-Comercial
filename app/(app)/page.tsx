// Versão: 1.0 | Data: 04/07/2026
// Home (placeholder da Fase 1). O construtor de dashboards chega na Fase 6.
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboards</h1>
        <p className="text-muted-foreground text-sm">
          Fundação pronta. O construtor de dashboards será entregue na Fase 6.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Bem-vindo</CardTitle>
          <CardDescription>
            Fase 1 (fundação) concluída: autenticação, papéis e navegação.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Próximas fases: sync do Bitrix, sync do Estudo de Fechamentos, edição
          de registros, colunas dinâmicas e o construtor de dashboards.
        </CardContent>
      </Card>
    </div>
  );
}
