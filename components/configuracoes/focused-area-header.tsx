// Versão: 1.0 | Data: 12/09/2026
// Cabeçalho das áreas com sub-itens (Operação e Configurações), 12/09/2026.
//
// Antes, entrar num item mantinha a fileira inteira de sub-abas na tela: as
// outras opções competiam com o conteúdo e não havia caminho de volta. Agora a
// área tem DOIS estados:
//  - ÍNDICE (o painel): título da área; as opções são os cards da página.
//  - ITEM: só o botão de voltar. O título vem do <h1> da própria página do item
//    (todas já têm o seu) — repetir "Operação" acima dele seria ruído.
//
// Client porque a decisão é pelo pathname; os layouts que o usam são server.
"use client";

import { usePathname } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";

export function FocusedAreaHeader({
  indexHref,
  title,
}: {
  /** Rota do painel da área (ex.: "/operacao"). */
  indexHref: string;
  /** Nome da área — vira o <h1> no painel e o rótulo do voltar num item. */
  title: string;
}) {
  const pathname = usePathname();
  const atIndex = pathname === indexHref;

  if (atIndex) {
    return <h1 className="text-2xl font-semibold">{title}</h1>;
  }
  return <BackLink href={indexHref} label={title} className="-ml-2 self-start" />;
}
