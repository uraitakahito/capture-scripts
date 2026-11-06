import { z } from "zod";

/**
 * クロールごとの値を読む見本。配らないので `catalog.json` には載せず、`pnpm run check` だけが読む。
 *
 * `.optional()` を付けなければ必須で、渡さないクロールは ts-compile-service が `BH0001` で止める。既定は
 * `.default` ではなく `??` で書く (宣言は走らせずに読むので、`.default` は読めない)。値は文字列だけ。
 */
(async () => {
  const { query, limit, mode } = defineParams(
    z.object({
      query: z.string().min(1).describe("検索語"),
      limit: z.string().optional().describe("件数の上限。省けば 10"),
      mode: z.enum(["title", "body"]).optional().describe("どこを探すか"),
    }),
  );
  globalThis.__bh.report({ query, limit: Number(limit ?? "10"), mode: mode ?? "title" });
})();
