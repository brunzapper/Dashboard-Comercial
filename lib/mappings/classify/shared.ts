// Versão: 1.0 | Data: 07/08/2026
// Constante compartilhada dos classificadores e do registry de domínios —
// módulo próprio para não criar ciclo domains ↔ classify (o registry importa
// os classificadores; eles só precisam do fallback).
export const UNCLASSIFIED = "Não Classificado";
