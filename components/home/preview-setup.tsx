"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { prepareInitialPreview } from "@/lib/dashboard-preview/bootstrap";
import { PREVIEW_FORMAT, previewNeedsUpdate } from "@/lib/dashboard-preview/geometry";
import { Button } from "@/components/ui/button";

/** Manutenção inicial explícita. Cada conta prepara só o que sua RLS permite. */
export function PreviewSetup({ rows, email }: { rows: {id:string;name:string;updated_at:string}[]; email:string }) {
  const host=useRef<HTMLDivElement>(null), controller=useRef<AbortController | null>(null);
  const [running,setRunning]=useState(false), [status,setStatus]=useState<Record<string,string>>({});
  useEffect(()=>()=>controller.current?.abort(),[]);
  const mark=(id:string,message:string)=>setStatus(prev=>({...prev,[id]:message}));
  async function prepare(bundle?: {viewerEmail:string;capturedAt:string;previews:{dashboardId:string;image:string;width:number;height:number;format?:string}[]}) {
    if(running || !host.current) return;
    if(bundle && bundle.viewerEmail.toLowerCase()!==email.toLowerCase()) { setStatus({error:"Entre com a conta que gerou as capturas."}); return; }
    setRunning(true); const abort=new AbortController(); controller.current=abort;
    try {
      for(const row of rows) {
        if(abort.signal.aborted) break;
        try {
          const response=await fetch(`/api/dashboard-previews/${row.id}?metadata`,{signal:abort.signal,cache:"no-store",priority:"low"});
          if(!response.ok) throw new Error("Armazenamento indisponível. Confira a migração 0145.");
          const meta=await response.json();
          if(!previewNeedsUpdate(meta)) {mark(row.id,"Já preparada");continue;}
          mark(row.id,"Preparando captura inicial…");
          const saved=bundle?.previews.find(p=>p.dashboardId===row.id);
          if(bundle && (!saved || saved.format !== PREVIEW_FORMAT || Date.parse(meta.revision)>Date.parse(bundle.capturedAt))) {mark(row.id,"Capture novamente: dashboard alterado ou imagem ausente.");continue;}
          const image=saved ?? await prepareInitialPreview(host.current,row.id,abort.signal);
          // Decodificação completa antes da publicação; falha mantém a anterior.
          const decoded=new Image();decoded.src=image.image;await decoded.decode();
          const result=await fetch(`/api/dashboard-previews/${row.id}`,{method:"POST",headers:{"Content-Type":"application/json"},signal:abort.signal,priority:"low",
            body:JSON.stringify({image:image.image,width:image.width,height:image.height,format:PREVIEW_FORMAT,revision:meta.revision,accessVersion:meta.accessVersion})});
          if(!result.ok) throw new Error("Não foi possível publicar; a imagem anterior foi preservada.");
          mark(row.id,"Pronta e salva");
        } catch(error) {if(!abort.signal.aborted) mark(row.id,error instanceof Error?error.message:"Falha ao preparar");}
      }
    } finally {setRunning(false);}
  }
  return <div className="space-y-5"><Link href="/" className="underline">Voltar ao Workspace</Link>
    <h1 className="text-2xl font-semibold">Preparar prévias</h1>
    <p>Preparação inicial para sua visão dos dados. As imagens ficam salvas na organização e as próximas visitas usam as miniaturas prontas.</p>
    <div className="flex flex-wrap gap-3"><Button disabled={running} onClick={()=>void prepare()}>Preparar capturas iniciais</Button>
      {running?<Button variant="outline" onClick={()=>controller.current?.abort()}>Parar</Button>:null}
      <label className="text-sm">Importar capturas já preparadas<input type="file" accept="application/json" disabled={running} onChange={async event=>{
        const file=event.target.files?.[0];if(!file)return;
        try {if(file.size>5_000_000)throw new Error();const bundle=JSON.parse(await file.text());
          if(typeof bundle.viewerEmail!=="string" || !Number.isFinite(Date.parse(bundle.capturedAt)) || !Array.isArray(bundle.previews) ||
            bundle.previews.some((p:{image?:unknown})=>typeof p.image!=="string" || !p.image.startsWith("data:image/webp;base64,") || p.image.length>53356))throw new Error();
          await prepare(bundle);
        }catch{setStatus({error:"Arquivo de capturas inválido."});}
      }}/></label></div>
    {status.error?<p role="alert">{status.error}</p>:null}
    <ul className="space-y-2">{rows.map(row=><li key={row.id}>{row.name} — {status[row.id]??"Aguardando preparação"}</li>)}</ul>
    <div ref={host} aria-hidden />
  </div>;
}
