import { expect, it } from "vitest";
import { PreviewCache, previewCacheKey } from "./cache";

it("reusa capturas e invalida por revisão, usuário, viewport e tema", () => {
  const cache = new PreviewCache();
  const key = previewCacheKey("user", "board", "v1", 1440, 900, "light");
  cache.set(key, "snapshot");
  expect(cache.get(key)).toBe("snapshot");
  for (const [scope, id, revision, width, height, theme] of [
    ["other", "board", "v1", 1440, 900, "light"], ["user", "board", "v2", 1440, 900, "light"],
    ["user", "board", "v1", 1000, 900, "light"], ["user", "board", "v1", 1440, 900, "dark"],
  ] as const) expect(cache.get(previewCacheKey(scope, id, revision, width, height, theme))).toBeUndefined();
});
it("limita memória por LRU e expira capturas antigas sem renovar a idade no acesso", () => {
  const cache = new PreviewCache(12, 100);
  cache.set("a", "aa", 0); cache.set("b", "bb", 0); cache.set("c", "cc", 0);
  expect(cache.get("a", 1)).toBe("aa");
  cache.set("d", "dd", 2);
  expect(cache.get("b", 3)).toBeUndefined();
  expect(cache.get("a", 101)).toBeUndefined();
  cache.set("too-large", "1234567", 3);
  expect(cache.get("too-large", 4)).toBeUndefined();
});
