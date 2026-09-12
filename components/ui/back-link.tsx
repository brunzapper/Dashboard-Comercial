// Versão: 1.0 | Data: 12/09/2026
// Botão "voltar" ÚNICO do app. O padrão visual já existia copiado em três
// formas diferentes (docs de Integrações, telas do Workflow, links de texto nas
// sub-páginas de Registros); este componente adota a mais recente — ghost + seta
// ANTES do título — e passa a ser o único lugar que a desenha.
//
// É sempre um <Link> com destino FIXO, nunca router.back(): quem chega por link
// direto (URL colada, notificação) tem um histórico que não leva ao painel.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  /** Nome do DESTINO (ex.: "Operação"), não a palavra "Voltar". */
  label: string;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={className ? `gap-1 ${className}` : "gap-1"}
    >
      <Link href={href} aria-label={`Voltar para ${label}`}>
        <ArrowLeft className="size-4" />
        {label}
      </Link>
    </Button>
  );
}
