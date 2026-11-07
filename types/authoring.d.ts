// 書く所 (scripts/) でだけ見える宣言。pnpm run build が generated/ へ写すときに置き換える。
// ts-compile-service へは写さない。generated/ の program (tsconfig.generated.json) にも見せないので、
// 書き込み損ねた onSite() は tag の前に tsc が TS2304 で止める。
/** 取り込むページが catalog.json の sites のどれかの上に在るか。 */
declare function onSite(): boolean;
/** catalog.json の sites の値。 */
declare function catalogSites(): readonly string[];
