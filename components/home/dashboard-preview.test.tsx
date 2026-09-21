// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DashboardPreview } from "./dashboard-preview";
import { PreviewQueueProvider } from "./preview-queue-context";
import { readLocalImage } from "@/lib/dashboard-preview/store";

vi.mock("next/link", () => ({default: "a"}));
vi.mock("@/lib/dashboard-preview/store", () => ({
  imageKey: (s:string,id:string,v:string) => `${s}/${id}/${v}`,
  readLocalImage:vi.fn(), cacheImage:vi.fn(),
}));
const meta={version:"one",width:1440,height:900,access_version:1};
function ui(preview: typeof meta | null = meta, scope="user") {
  return <PreviewQueueProvider><DashboardPreview id="board" name="Vendas" scope={scope} preview={preview ?? undefined}/></PreviewQueueProvider>;
}
beforeEach(()=>{
  vi.stubGlobal("IntersectionObserver",class { constructor(private cb:IntersectionObserverCallback){} observe(){this.cb([{isIntersecting:true}] as IntersectionObserverEntry[],this as unknown as IntersectionObserver);} disconnect(){} });
  vi.stubGlobal("Image",class {src="";async decode(){} });
  vi.stubGlobal("fetch",vi.fn());
  vi.mocked(readLocalImage).mockReset();
});
it("Workspace sem captura nunca abre dashboards nem consulta engine",async()=>{
  const {container}=render(ui(null));
  await act(()=>new Promise(r=>setTimeout(r,30)));
  expect(fetch).not.toHaveBeenCalled();expect(container.querySelector("iframe")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/dashboards/board");
});
it("reusa arquivo local e conserva a imagem anterior até a nova estar pronta",async()=>{
  vi.mocked(readLocalImage).mockResolvedValue({key:"one",image:"data:image/webp;base64,old",at:0});
  const view=render(ui());
  await waitFor(()=>expect(view.container.querySelector("img")?.src).toContain("old"));
  let release!:(value:{key:string;image:string;at:number})=>void;
  vi.mocked(readLocalImage).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  view.rerender(ui({...meta,version:"two"}));
  await waitFor(()=>expect(readLocalImage).toHaveBeenCalledWith("user/board/two"));
  expect(view.container.querySelector("img")?.src).toContain("old");
  await act(async()=>release({key:"two",image:"data:image/webp;base64,new",at:1}));
  await waitFor(()=>expect(view.container.querySelector("img")?.src).toContain("new"));
  expect(fetch).not.toHaveBeenCalled();expect(view.container.querySelector("iframe")).toBeNull();
});
it("trocar usuário não mostra a captura anterior enquanto a nova carrega",async()=>{
  vi.mocked(readLocalImage).mockResolvedValue({key:"one",image:"data:image/webp;base64,private",at:0});
  const view=render(ui());await waitFor(()=>expect(view.container.querySelector("img")).not.toBeNull());
  vi.mocked(readLocalImage).mockImplementation(()=>new Promise(()=>{}));
  view.rerender(ui(meta,"other"));expect(view.container.querySelector("img")).toBeNull();
});
