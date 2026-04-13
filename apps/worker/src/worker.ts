const jobs = [
  "ingest.my_tw_coverage",
  "brief.generate_daily",
  "signal.enrich",
  "review.refresh_metrics",
  "openalice.run_task"
];

console.log("IUF Trading Room worker booted.");
console.log("Registered Wave 0 job placeholders:");
for (const job of jobs) {
  console.log(`- ${job}`);
}
