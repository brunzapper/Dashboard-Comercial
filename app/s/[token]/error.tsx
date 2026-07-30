// Versão: 1.0 | Data: 29/07/2026
// Boundary de erro do viewer público: falha inesperada ao computar o snapshot
// (timeout/Supabase) mostrava a tela crua do Next ao destinatário externo.
// Mensagem neutra + tentar novamente; sem detalhes internos e sem link p/ app.
"use client";

export default function SnapshotError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center text-neutral-900">
      <h1 className="text-xl font-semibold">Não foi possível carregar o painel</h1>
      <p className="max-w-md text-sm text-neutral-600">
        Ocorreu um erro passageiro ao montar este painel. Tente de novo em
        instantes.
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
      >
        Tentar novamente
      </button>
    </div>
  );
}
