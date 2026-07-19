import {
  formatMilestoneDate,
  milestoneState,
  todayTaipeiDate,
  type Milestone,
} from "@/lib/quant-strategies-content";
import styles from "./QuantStrategies.module.css";

const STATE_LABEL: Record<ReturnType<typeof milestoneState>, string> = {
  done: "已完成",
  upcoming: "即將到來",
  pending: "待排定",
};

/** 里程碑三步：模擬盤觀察起算 / 排程首組合 / 真金試點。狀態依當下台北日期算，
 * 不需要每次改日期都手動調整 done/upcoming。 */
export function MilestoneTrack({ milestones }: { milestones: Milestone[] }) {
  const today = todayTaipeiDate();
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
