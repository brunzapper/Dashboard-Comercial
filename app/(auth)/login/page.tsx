// Versão: 1.0 | Data: 04/07/2026
// Página de login. Sem signup público: usuários são provisionados por um admin.
// Next.js 16: searchParams é uma Promise (Async Request APIs).
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;
  const safeRedirect =
    redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Dashboard Comercial</CardTitle>
          <CardDescription>Acesse com seu email e senha</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={safeRedirect} />
        </CardContent>
      </Card>
    </main>
  );
}
