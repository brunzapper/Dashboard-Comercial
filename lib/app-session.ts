// Versão: 1.0 | Data: 17/07/2026
// Flag "app já aberto nesta sessão do navegador" (sessionStorage, client-only).
// O RestoreLastView (Home) usa a leitura para distinguir REABERTURA do app
// (restaura user_settings.lastView) de navegação interna (não redireciona);
// AppShell e RestoreLastView marcam a flag ao montar. sessionStorage morre ao
// fechar a aba — é exatamente a semântica de "fechou e reabriu o sistema".

const KEY = "appSessionActive";

export function isFreshAppSession(): boolean {
  try {
    return sessionStorage.getItem(KEY) === null;
  } catch {
    // storage bloqueado: trata como sessão já ativa (nunca redireciona).
    return false;
  }
}

export function markAppSessionActive(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // storage bloqueado — sem restauração nesta sessão.
  }
}
