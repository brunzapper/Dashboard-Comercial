import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/auth/org";
import { PreviewSetup } from "@/components/home/preview-setup";

export default async function PreparePreviewsPage() {
  const session = await requireSession(), org = await getActiveOrg(), supabase = await createClient();
  let query = supabase.from("dashboards").select("id,name,updated_at").eq("kind","dashboard").neq("status","trashed").order("created_at",{ascending:false});
  if (org) query = query.eq("organization_id",org.id);
  const {data} = await query;
  return <PreviewSetup rows={data ?? []} email={session.user.email ?? ""} />;
}
