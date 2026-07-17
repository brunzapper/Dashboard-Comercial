// Versão: 1.0 | Data: 17/07/2026
// Widget Imagem (visual_type 'imagem'): renderiza uma URL https externa num
// <img> SEM cromo de card (frameless, fundo transparente — PNG com alpha
// aparece limpo sobre o dashboard). Redimensionar é o resize nativo do grid;
// settings.image.fit (object-fit) controla como a imagem ocupa o card.
// Clique fora do modo edição é configurável: nada, ampliar em lightbox
// (portal no body — position:fixed não funciona dentro do item transformado
// do grid) ou abrir um link personalizado em nova aba (nunca a URL da
// própria imagem). No modo edição, clicar no card abre o editor.
// Segurança: a URL é re-validada AQUI além da escrita (sanitizeHttpsUrl) —
// o settings congelado chega ao viewer público de snapshots sem passar
// pelas actions; nada que não seja https vira src/href. referrerPolicy
// no-referrer evita vazar a URL do dashboard ao host da imagem.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleOff, Image as ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WidgetSettings } from "@/lib/widgets/types";
import { sanitizeHttpsUrl } from "@/lib/widgets/image-url";

function Placeholder({
  icon: Icon,
  text,
  clickable,
}: {
  icon: typeof ImageIcon;
  text: string;
  clickable: boolean;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-2 text-center text-xs",
        clickable && "hover:bg-accent/30 cursor-pointer"
      )}
    >
      <Icon className="size-5 opacity-60" />
      {text}
    </div>
  );
}

export function ImageWidget({
  image,
  title,
  editMode,
  canEdit,
  onConfigure,
}: {
  image?: WidgetSettings["image"];
  title: string | null;
  editMode: boolean;
  canEdit: boolean;
  // Abre o editor (builder) — clique no card no modo edição.
  onConfigure: () => void;
}) {
  const url = sanitizeHttpsUrl(image?.url);
  const alt = image?.alt?.trim() || title || "Imagem";
  const clickAction = image?.click?.action ?? "none";
  const href = clickAction === "link" ? sanitizeHttpsUrl(image?.click?.href) : null;

  // Erro de carregamento por URL: trocar a URL limpa o estado sozinho.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = url != null && failedUrl === url;

  const [lightbox, setLightbox] = useState(false);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const configurable = editMode && canEdit;

  if (!url || failed) {
    const body = !url ? (
      <Placeholder
        icon={ImageIcon}
        text={
          configurable
            ? "Clique para definir a URL da imagem"
            : "Imagem não configurada"
        }
        clickable={configurable}
      />
    ) : (
      <Placeholder
        icon={CircleOff}
        text="Imagem indisponível — verifique a URL"
        clickable={configurable}
      />
    );
    return configurable ? (
      <button type="button" className="block h-full w-full" onClick={onConfigure}>
        {body}
      </button>
    ) : (
      body
    );
  }

  const img = (
    // next/image exige allowlist remotePatterns — inviável p/ URL arbitrária.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="h-full w-full"
      style={{ objectFit: image?.fit ?? "contain" }}
      draggable={false}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)}
    />
  );

  if (configurable) {
    return (
      <button
        type="button"
        className="block h-full w-full cursor-pointer"
        onClick={onConfigure}
        title="Clique para editar a imagem"
        aria-label={`Editar imagem${title ? ` (${title})` : ""}`}
      >
        {img}
      </button>
    );
  }

  if (clickAction === "link" && href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full w-full cursor-pointer"
        title={href}
      >
        {img}
      </a>
    );
  }

  if (clickAction === "lightbox") {
    return (
      <>
        <button
          type="button"
          className="block h-full w-full cursor-zoom-in"
          onClick={() => setLightbox(true)}
          title="Ampliar imagem"
          aria-label={`Ampliar imagem${title ? ` (${title})` : ""}`}
        >
          {img}
        </button>
        {lightbox
          ? createPortal(
              <div
                className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
                role="dialog"
                aria-modal="true"
                aria-label={alt}
                onClick={() => setLightbox(false)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- URL arbitrária do usuário (ver acima) */}
                <img
                  src={url}
                  alt={alt}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                  referrerPolicy="no-referrer"
                />
              </div>,
              document.body
            )
          : null}
      </>
    );
  }

  return img;
}
