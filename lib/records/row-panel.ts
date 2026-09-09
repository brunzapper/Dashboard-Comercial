// Versão: 1.0 | Data: 09/09/2026
// Constantes do painel do clique na linha.
//
// Vivem AQUI e não na action porque um módulo `"use server"` só pode exportar
// funções async: uma constante de valor ali quebra o build (e quebrou — o
// arquivo é importado por um Client Component, e o Turbopack recusa). Tipos
// são apagados na compilação e podem ficar na action; valores, não.
"use client";

/** Tamanho de uma página de tarefas no painel do clique. */
export const ROW_TASKS_PAGE = 20;
