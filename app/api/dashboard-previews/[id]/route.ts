// v2.0 | 21/09/2026 — cache HTTP para imagens versionadas + query otimizada
// (removida query separada de dashboards no GET de imagem — a RLS de
// dashboard_preview_images já garante auth_board_visible + status <> 'trashed')
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/lib/auth/session";
import { validPreviewUpload } from "@/lib/dashboard-preview/validation";

const BUCKET = "dashboard-previews";
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const supabase = await createClient();
  // v2.0: ?metadata ainda precisa de dashboards.updated_at para o recorder
  if (url.searchParams.has("metadata")) {
    const { data: dashboard } = await supabase.from("dashboards").select("updated_at, status").eq("id", id).maybeSingle();
    if (!dashboard || dashboard.status === "trashed") return new Response(null, { status: 404, headers: noStore });
    const { data: preview } = await supabase.from("dashboard_preview_images")
      .select("version, revision, object_path, width, height, access_version").eq("dashboard_id", id).maybeSingle();
    const { data: epoch } = await supabase.from("dashboard_preview_access_epoch").select("version").single();
    if (!epoch) return new Response(null, { status: 503, headers: noStore });
    return Response.json({ revision: dashboard.updated_at, accessVersion: epoch.version, preview }, { headers: noStore });
  }
  // v2.0: GET de imagem — RLS de dashboard_preview_images já filtra por
  // auth_board_visible + status <> 'trashed'; sem query extra de dashboards
  const { data: preview } = await supabase.from("dashboard_preview_images")
    .select("version, object_path").eq("dashboard_id", id).maybeSingle();
  if (!preview || preview.version !== url.searchParams.get("v")) return new Response(null, { status: 404, headers: noStore });
  const { data, error } = await supabase.storage.from(BUCKET).download(preview.object_path);
  if (error || !data) return new Response(null, { status: 404, headers: noStore });
  // v2.0: imagem versionada por UUID — cache privado de 24h, imutável
  return new Response(data, { headers: {
    "Cache-Control": "private, max-age=86400, immutable",
    "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
  } });
}

export async function POST(request: Request, context: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const session = await getSessionInfo();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await context.params;
  // Limite antes de parsear: até clientes sem Content-Length são limitados.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 58_000) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return new Response(null, { status: 400 }); }
  const entry = validPreviewUpload(payload);
  if (!entry) return new Response(null, { status: 400 });
  const supabase = await createClient();
  const { data: dashboard } = await supabase.from("dashboards").select("organization_id, updated_at, status").eq("id", id).maybeSingle();
  if (!dashboard || dashboard.status === "trashed") return new Response(null, { status: 404 });
  if (Date.parse(dashboard.updated_at) !== Date.parse(entry.revision)) return new Response(null, { status: 409 });
  // Metadado antigo pode estar oculto pelo epoch; lookup restrito serve apenas
  // para limpar o arquivo substituído, nunca para entregá-lo ao cliente.
  const { data: previous } = await createServiceClient().from("dashboard_preview_images")
    .select("object_path").eq("dashboard_id", id).eq("user_id", session.user.id).maybeSingle();
  const path = `${dashboard.organization_id}/${session.user.id}/${id}/${crypto.randomUUID()}.webp`;
  const bytes = Buffer.from(entry.image.slice("data:image/webp;base64,".length), "base64");
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false });
  if (uploadError) return new Response(null, { status: 503 });
  const { data: published, error } = await supabase.rpc("publish_dashboard_preview", {
    p_dashboard: id, p_revision: entry.revision, p_access_version: entry.accessVersion,
    p_path: path, p_bytes: bytes.length, p_width: entry.width, p_height: entry.height,
  });
  if (!published || error) {
    await removeOwnedPreview(path, session.user.id);
    return new Response(null, { status: error ? 503 : 409 });
  }
  if (previous?.object_path) await removeOwnedPreview(previous.object_path, session.user.id);
  return new Response(null, { status: 204 });
}

/** Cleanup limitado a um caminho já derivado/consultado para o usuário atual.
 * Storage exige SELECT para delete; arquivos substituídos deixam de ser legíveis. */
async function removeOwnedPreview(path: string, userId: string) {
  if (path.split("/")[1] !== userId) return;
  try { await createServiceClient().storage.from(BUCKET).remove([path]); }
  catch { /* Não desfaz a publicação já confirmada. */ }
}
