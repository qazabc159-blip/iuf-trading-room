import {
  formatMilestoneDate,
  milestoneState,
  type Milestone,
} from "@/lib/quant-strategies-content";
import styles from "./QuantStrategies.module.css";

const STATE_LABEL: Record<ReturnType<typeof milestoneState>, string> = {
  done: "已完成",
  upcoming: "即將到來",
  pending: "待排定",
};

/** 里程碑三步：模擬盤觀察起算 / 排程首組合 / 真金試點。狀態依台北日期算，
 * 不需要每次改日期都手動調整 done/upcoming。`today` 由呼叫端（page.tsx）用
 * `todayTaipeiDate()` 算一次傳進來，跟同一張卡的 badge／下一個動作
 * （`deriveStrategyProgress()`）共用同一個「現在」，避免兩邊各自呼叫
 * `Date.now()` 理論上可能跨到不同日曆日的邊界情況。 */
export function MilestoneTrack({ milestones, today }: { milestones: Milestone[]; today: string }) {
  return (
    <ol className={styles.milestoneTrack} aria-label="里程碑進度">
      {milestones.map((milestone) => {
        const state = milestoneState(milestone.date, today);
        return (
          <li key={milestone.label} className={styles.milestoneStep} data-state={state}>
            <span className={styles.milestoneDot} aria-hidden="true" />
            <span className={styles.milestoneLabel}>{milestone.label}</span>
            <span className={styles.milestoneDate}>{formatMilestoneDate(milestone.date)}</span>
            <span className={styles.milestoneStateText}>{STATE_LABEL[state]}</span>
          </li>
        );
      })}
    </ol>
  );
}
