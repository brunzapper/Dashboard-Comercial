// Versão: 1.0 | Data: 08/09/2026
// Stub de `server-only` para o Vitest. O pacote real existe para QUEBRAR o
// build quando um módulo de servidor é importado por um Client Component — é
// uma guarda do bundler, e quem a aplica é o `next build`. Sob Node, no teste,
// ele só lança e impede que módulos legítimos de servidor sejam exercitados
// (lib/records/formula-server.ts, lib/comp/plan-validate.ts…), empurrando o
// código para o formato "sem server-only" só para virar testável — o que
// enfraquece a guarda de verdade em produção.
// Aliasado em vitest.config.ts; não importe este arquivo diretamente.
export {};
