// @vitest-environment jsdom
// CI opts in after installing Chromium; local runs can point to an existing Chrome.
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { BoardGrid, type DashboardRow } from "@/components/home/hub-cards";
import { HubDisplayProvider } from "@/components/home/hub-display-context";
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/app/(app)/dashboards/actions", () => ({ saveUiPrefs: vi.fn() }));
vi.mock("@/lib/use-debounced-refresh", () => ({ useDebouncedRefresh: () => vi.fn() }));
vi.mock("@/components/dashboards/board-card-menu", () => ({ BoardCardMenu: () => null }));
vi.mock("@/components/home/pin-button", () => ({ PinButton: () => null }));
vi.mock("@/lib/dashboard-preview/load", async original => ({
  ...await original<typeof import("@/lib/dashboard-preview/load")>(),
  loadPreviewMetadata: vi.fn(async () => ({ revision: "same", accessVersion: 1, preview: {
    revision: "same", version: "one", width: 560, height: 560, access_version: 1, format: "tabs-v2",
  } })),
  loadPreviewImage: vi.fn(async () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560"><rect width="560" height="560" fill="#f3f4f6"/><text x="20" y="32" font-size="18">Aba Vendas</text><rect x="20" y="60" width="520" height="140" rx="8" fill="white"/><text x="40" y="105" font-size="18">Receita</text><text x="40" y="160" font-size="36">R$ 120.000</text><rect x="20" y="220" width="520" height="310" rx="8" fill="white"/><path d="M50 450 L140 410 L230 425 L320 340 L410 370 L500 280" fill="none" stroke="#7431b3" stroke-width="6"/></svg>')),
}));

it.skipIf(!process.env.PREVIEW_BROWSER_TEST && !process.env.PREVIEW_BROWSER_EXECUTABLE)("real BoardGrid keeps full-width previews and visible titles with production Tailwind CSS", async () => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe() { this.cb([{ isIntersecting: true }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  const rows: DashboardRow[] = Array.from({ length: 8 }, (_, i) => ({
    id: `board-${i}`, name: ["Funil de Vendas", "Overview Comercial", "Vendas à Vista", "Pré-Vendas Inbound", "Performance SDR", "Coordenação Comercial", "Metas do time", "Análise Completa"][i],
    description: "Indicadores e evolução comercial", owner_user_id: null, visible_to_roles: [], kind: "dashboard", status: "active", trashed_at: null, settings: null,
  }));
  const view = render(<HubDisplayProvider locked={[]} keys={{ layout: "hubLayout", columns: "hubColumns", cardHeight: "hubCardHeight", showDescription: "hubShowDescription", showAccess: "hubShowAccess" }}
    initial={{ layout: "preview", columns: 4, cardHeight: 900, showDescription: true, showAccess: true }}>
    <BoardGrid rows={rows} canCreate={false} isAdmin={false} pins={[]} userId="user" />
  </HubDisplayProvider>);
  await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(8));
  const file = path.resolve("app/globals.css");
  const { css } = await postcss([tailwind({ base: process.cwd() })]).process(readFileSync(file, "utf8"), { from: file });
  const browser = await chromium.launch({ executablePath: process.env.PREVIEW_BROWSER_EXECUTABLE, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style><main style="padding:24px">${view.container.innerHTML}</main>`);
    for (const width of [1335, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const measurements = await page.locator("[data-hub-preview]").evaluateAll(cards => cards.map(card => {
        const box = card.getBoundingClientRect();
        const header = card.querySelector('[data-slot="card-header"]')!.getBoundingClientRect();
        const title = card.querySelector('[data-slot="card-title"]')!.getBoundingClientRect();
        const image = card.querySelector('a[aria-label]')!.getBoundingClientRect();
        return { width: box.width, height: box.height, imageWidth: image.width, imageHeight: image.height, headerWidth: header.width, titleWidth: title.width, titleHeight: title.height };
      }));
      if (process.env.PREVIEW_BROWSER_OUTPUT && width === 1335) {
        await page.screenshot({ path: process.env.PREVIEW_BROWSER_OUTPUT, fullPage: true });
        writeFileSync(process.env.PREVIEW_BROWSER_OUTPUT + ".json", JSON.stringify(measurements, null, 2));
      }
      for (const box of measurements) {
        expect(Math.abs(box.width - box.height)).toBeLessThan(1);
        expect(box.imageWidth / box.width).toBeGreaterThan(0.85);
        expect(box.headerWidth / box.width).toBeGreaterThan(0.9);
        expect(box.titleWidth).toBeGreaterThan(80);
        expect(box.titleHeight).toBeGreaterThan(10);
        expect(box.imageHeight / box.height).toBeGreaterThan(0.25);
      }
    }
  } finally { await browser.close(); view.unmount(); vi.unstubAllGlobals(); }
}, 60_000);
