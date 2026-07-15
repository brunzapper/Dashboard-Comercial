// Versão: 1.0 | Data: 15/07/2026
// Token de acesso público de um snapshot — SÓ NO SERVIDOR (node:crypto).
// 256 bits aleatórios em base64url (43 chars). O banco guarda apenas o sha256
// (snapshots.token_hash); o token em claro é exibido UMA vez, na criação.
// Força bruta é inviável (2^256) e um vazamento do banco não expõe links.
import { createHash, randomBytes } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Gera um token novo (256 bits, base64url). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex do token — a ÚNICA forma persistida. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Formato válido de token? Barra requisições malformadas antes de qualquer
 * consulta (o loader público responde 404 uniforme sem tocar o banco).
 */
export function isTokenShaped(s: string): boolean {
  return TOKEN_RE.test(s);
}
