// Versão: 1.0 | Data: 19/11/2026
// "É O MESMO DADO?" no import de CSV (esquema por Base, fase 4) — módulo PURO.
//
// `field_key` é único por organização. Antes, um cabeçalho cujo slug batia com
// um campo de OUTRA Base (`status`, `empresa`, `cadencia`…) era reusado em
// silêncio: os dois dados viravam um só campo, com o mesmo rótulo e as mesmas
// opções (32 de 69 campos de CSV em produção). Agora o wizard detecta a
// colisão e pergunta. Sim ⇒ reusa a chave (o campo passa a valer também nesta
// Base). Não ⇒ cria um campo próprio com `distinctFieldKey`.
import { distinctFieldKey, slugify } from "@/lib/records/slug";

export interface CollisionField {
  key: string;
  label: string;
  appliesTo: string[];
}

export interface CollisionPlan {
  target: string;
  newLabel: string;
  /** "Não é o mesmo dado" já respondido. */
  distinct?: boolean;
  /** "É o mesmo dado" já respondido. */
  same?: boolean;
}

export interface Collision {
  field: CollisionField;
  /** Chave que o campo próprio ganharia. */
  distinctKey: string;
}

/**
 * O destino desta coluna é um campo DECLARADO para outra(s) Base(s)? Campo
 * "de todas" (applies_to vazio) não é colisão — já vale aqui.
 */
export function csvCollision(
  plan: CollisionPlan,
  fields: readonly CollisionField[],
  recordType: string,
  sourceKey: string
): Collision | null {
  let key = "";
  if (plan.target === "new") key = slugify(plan.newLabel);
  else if (plan.target.startsWith("custom:")) key = plan.target.slice(7);
  if (!key) return null;
  const field = fields.find((f) => f.key === key);
  if (!field) return null;
  if (field.appliesTo.length === 0 || field.appliesTo.includes(recordType)) {
    return null;
  }
  return { field, distinctKey: distinctFieldKey(key, sourceKey) };
}

/** Colisão ainda sem resposta (bloqueia o "Continuar"). */
export function collisionPending(
  plan: CollisionPlan,
  collision: Collision | null
): boolean {
  if (!collision) return false;
  if (plan.target === "new") return !plan.distinct && !plan.same;
  return !plan.same;
}
