// @vitest-environment jsdom
// Versão: 1.0 | Data: 31/07/2026
// Primitivo Table: o wrapper mantém overflow-x-auto por padrão (guarda os
// ~29 consumidores que não passam nada) e `containerClassName` substitui a
// classe via twMerge (RecordsTable passa overflow-x-visible p/ o pan de mão
// atuar no scroller externo dele).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Table } from "@/components/ui/table";

const container = (el: HTMLElement) =>
  el.querySelector('[data-slot="table-container"]')!;

describe("Table", () => {
  it("default mantém overflow-x-auto no wrapper", () => {
    const { container: root } = render(<Table />);
    expect(container(root).className).toContain("overflow-x-auto");
  });

  it("containerClassName substitui o overflow do wrapper", () => {
    const { container: root } = render(
      <Table containerClassName="overflow-x-visible" />
    );
    const cls = container(root).className;
    expect(cls).toContain("overflow-x-visible");
    expect(cls).not.toContain("overflow-x-auto");
  });
});
