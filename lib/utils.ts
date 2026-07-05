// Versão: 1.0 | Data: 04/07/2026
// Utilitário `cn` (clsx + tailwind-merge) usado pelos componentes de UI.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
