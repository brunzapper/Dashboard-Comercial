// Versão: 1.0 | Data: 29/07/2026
// Boundary de erro do layout RAIZ (substitui o <html> inteiro quando o próprio
// layout/template raiz falha). Estilos inline de propósito: globals.css pode
// não ter carregado. Mensagem neutra pt-BR + tentar novamente.
"use client";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: "#fff",
          color: "#0a0a0a",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Algo deu errado
          </h1>
          <p style={{ fontSize: 14, color: "#525252", marginBottom: 16 }}>
            Ocorreu um erro inesperado ao carregar a aplicação.
            {error?.digest ? ` (código ${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #d4d4d4",
              background: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
