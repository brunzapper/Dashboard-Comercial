import { expect, it } from "vitest";
import config from "../next.config";

it("permite somente a prévia autenticada em iframe do mesmo origin", async () => {
  const rules = await config.headers!();
  const general = rules.find((rule) => rule.source === "/:path*")!;
  const preview = rules.find((rule) => rule.source === "/dashboards/:id/preview")!;
  expect(general.headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
  expect(general.headers.find((header) => header.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'none'");
  expect(preview.headers).toContainEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" });
  expect(preview.headers.find((header) => header.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'self'");
  expect(rules.indexOf(preview)).toBeGreaterThan(rules.indexOf(general));
});
