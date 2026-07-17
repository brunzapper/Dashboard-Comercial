// Versão: 1.0 | Data: 17/07/2026
// Cifra reversível para segredos que o servidor precisa LER de volta (ex.: o
// segredo HMAC dos webhooks de saída — assinar exige o plaintext, então hash
// não serve). AES-256-GCM com chave-mestra em env (KEY_ENCRYPTION_KEY, 32
// bytes base64), IV aleatório de 12 bytes por cifra e tag de autenticação.
// Formato persistido: "v1:<iv b64>:<tag b64>:<ct b64>". SÓ NO SERVIDOR.
// Desenho conforme docs/estudo-ingestao-api.md §3 ("AES-256-GCM no app").
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getKeyEncryptionKey } from "@/lib/env";

const VERSION = "v1";
const IV_BYTES = 12;

function masterKey(): Buffer {
  const key = Buffer.from(getKeyEncryptionKey(), "base64");
  if (key.length !== 32) {
    throw new Error(
      "KEY_ENCRYPTION_KEY inválida: esperados 32 bytes em base64."
    );
  }
  return key;
}

/** Cifra um segredo. Retorna "v1:<iv>:<tag>:<ct>" (tudo base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** Decifra um segredo cifrado por encryptSecret. Lança em formato/chave errada. */
export function decryptSecret(box: string): string {
  const parts = box.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Segredo cifrado em formato inválido.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
