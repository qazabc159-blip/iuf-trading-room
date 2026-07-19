import styles from "./QuantStrategies.module.css";

/**
 * QuantSectionTag — 首頁「AI 推薦個股 TODAY RECS」斜切金色標籤的視覺語言
 * （`.tac-ledger .tab` in globals.css：金底、clip-path 切角、中文主標 + mono
 * 英文副標）。首頁那份 CSS 只在 `.tac-ledger` scope 生效（只掛在首頁），本頁
 * 沒有引入整套首頁 ledger layout，改用同一組全站 `--gold`/`--night-*` token
 * 在這裡的 CSS module 重畫同一份切角視覺——同色階、同字體、同密度，是「借
 * 用視覺語言」而非另立一套設計系統。
 */
export function QuantSectionTag({ zh, en }: { zh: string; en: string }) {
  return (
    <div className={styles.sectionTab}>
      {zh} <span className={styles.sectionTabEn}>{en}</span>
    </div>
  );
}
