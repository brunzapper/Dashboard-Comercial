// Versão: 1.0 | Data: 23/07/2026
// Server Actions da tela pós-login de escolha de contexto (multi-org, 0089):
// grava o cookie da org ATIVA (sempre revalidado contra membership — o cookie
// nunca é confiado; ver lib/auth/org.ts) ou entra no modo Owner (cookie
// limpo; o guard requireOwner decide lá).
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getMemberships, ORG_COOKIE } from "@/lib/auth/org";
import { getIsOwner } from "@/lib/auth/owner";
import { requireSession } from "@/lib/auth/session";

const ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 ano; revalidado a cada uso

export async function selectOrgAction(orgId: string): Promise<void> {
  await requireSession();
  const memberships = await getMemberships();
  if (!memberships.some((m) => m.organization_id === orgId)) {
    // Escolha inválida/forjada: volta à seleção (nada é gravado).
    redirect("/escolher-organizacao");
  }
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ORG_COOKIE_MAX_AGE,
  });
  redirect("/");
}

export async function enterOwnerModeAction(): Promise<void> {
  await requireSession();
  if (!(await getIsOwner())) redirect("/");
  redirect("/owner");
}
