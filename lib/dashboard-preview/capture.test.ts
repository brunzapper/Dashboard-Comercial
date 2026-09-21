// @vitest-environment jsdom
import { expect, it } from "vitest";
import { snapshotDocument, capturePreview } from "./capture";

it("captura conteúdo/SVG sem scripts, handlers ou widgets fora da janela", () => {
  const doc = document.implementation.createHTMLDocument("Dashboard");
  doc.head.innerHTML += '<link rel="stylesheet" href="/style.css"><script>fetch("/action")</script>';
  doc.body.innerHTML = '<main onclick="alert(1)"><svg><text>Receita</text></svg><div class="react-grid-item">Visível</div><div class="react-grid-item">Fora da janela</div><iframe src="/other"></iframe></main>';
  const widgets = doc.querySelectorAll(".react-grid-item");
  widgets[0].getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 100, right: 100 }) as DOMRect;
  widgets[1].getBoundingClientRect = () => ({ top: 1000, left: 0, bottom: 1100, right: 100 }) as DOMRect;
  const html = snapshotDocument(doc, 1440, 900);
  expect(html).toContain("Receita"); expect(html).toContain("Visível"); expect(html).toContain("/style.css");
  expect(html).not.toContain("Fora da janela"); expect(html).not.toContain("<script");
  expect(html).not.toContain("onclick"); expect(html).not.toContain("<iframe");
  expect(html).toContain("inert");
});
it("cancelar remove imediatamente o iframe vivo e rejeita a captura", async () => {
  const host = document.createElement("span"), controller = new AbortController();
  document.body.append(host);
  const promise = capturePreview(host, "/dashboards/test/preview", 1440, 900, controller.signal);
  expect(host.querySelector("iframe")).not.toBeNull();
  controller.abort();
  expect(host.querySelector("iframe")).toBeNull();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  host.remove();
});
