import DashboardPage from "../page";

/** Reusa toda a consulta autenticada/ACL; não cria um viewer público. */
export default function DashboardPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  return DashboardPage({ params, searchParams: Promise.resolve({ workspacePreview: "1" }) });
}
