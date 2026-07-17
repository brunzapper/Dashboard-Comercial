// Versão: 1.0 | Data: 17/07/2026
// Validação de URLs do widget Imagem (visual_type 'imagem'). Só https é
// aceito: bloqueia javascript:/data:/blob: (XSS via src/href) e http (mixed
// content, que o browser bloquearia de toda forma). Roda em TRÊS pontos:
// no builder (feedback imediato), nas server actions de escrita de settings
// (defesa real — o jsonb é frouxo e a RLS não valida shape) e na renderização
// (defesa em profundidade: dados antigos/escritos por fora chegam ao viewer
// público de snapshots sem passar pelas actions).

import type { WidgetSettings } from "@/lib/widgets/types";

// Normaliza uma URL externa: retorna a forma canônica se for https válida,
// senão null. Serve tanto para o src da imagem quanto para o href do clique.
export function sanitizeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return url.toString();
}

// Saneia settings.image antes de persistir: URLs inválidas são descartadas
// (nunca gravadas). Sem chave image, retorna o objeto intocado — os demais
// tipos de widget não são afetados.
export function sanitizeImageSettings(
  settings: WidgetSettings | null | undefined
): WidgetSettings {
  const s = settings ?? {};
  if (!s.image) return s;
  const url = sanitizeHttpsUrl(s.image.url);
  const href = sanitizeHttpsUrl(s.image.click?.href);
  return {
    ...s,
    image: {
      ...s.image,
      url: url ?? undefined,
      click: s.image.click
        ? { ...s.image.click, href: href ?? undefined }
        : undefined,
    },
  };
}
