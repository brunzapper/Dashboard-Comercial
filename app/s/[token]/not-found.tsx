// Versão: 1.0 | Data: 29/07/2026
// 404 do viewer público de snapshot. A page usa um notFound() ÚNICO para token
// malformado/inexistente/pausado/revogado/expirado (uniformidade é decisão de
// segurança — não diferenciar aqui). Mensagem neutra pt-BR para o destinatário
// externo, SEM link para o app (ele não tem conta). Sempre claro, como o
// viewer (o script de tema ignora /s/*).
export default function SnapshotNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center text-neutral-900">
      <h1 className="text-xl font-semibold">Link indisponível</h1>
      <p className="max-w-md text-sm text-neutral-600">
        Este link de painel é inválido, expirou ou foi desativado. Peça um novo
        link a quem compartilhou este painel com você.
      </p>
    </div>
  );
}
