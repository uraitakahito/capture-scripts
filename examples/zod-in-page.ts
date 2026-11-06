import { z } from "zod";

/**
 * ページから読んだ値の形を Zod で確かめる見本。配らないので `catalog.json` には載せず、`pnpm run typecheck` だけが読む。
 *
 * `parse` ではなく `safeParse` と `__bh.log.error` を使う。`parse` の例外は「1 本の書き損じで他を落とさない」
 * 決まりで行 1 つになり、ts-compile-service が minify した束では `l: ZodError` としか残らない。どの項目が
 * 違ったかは、自分でログに書かないと残らない。形が合わなくてもクロールは成功のまま。
 */
(async () => {
  const Page = z.object({
    title: z.string().min(1),
    lang: z.string().length(2),
  });

  const parsed = Page.safeParse({
    title: document.title,
    lang: document.documentElement.lang,
  });
  if (!parsed.success) {
    globalThis.__bh.log.error("ページの形が想定と違う", z.treeifyError(parsed.error));
    return;
  }

  // ここからは型が付く（title: string）
  const { title, lang } = parsed.data;
  globalThis.__bh.report({ title, lang });
})();
