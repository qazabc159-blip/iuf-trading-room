/**
 * One-off: PATCH theme names from ASCII placeholder to correct Chinese.
 * Usage: node --import tsx ./scripts/apply-theme-names-patch.ts
 */
import { writeFileSync } from "node:fs";

const BASE_URL =
  process.env.API_URL ?? "https://api-production-8f08.up.railway.app";
const WORKSPACE = process.env.WORKSPACE_SLUG ?? "primary-desk";

interface PatchEntry {
  id: string;
  name: string;
  note: string;
}

const patches: PatchEntry[] = [
  { id: "37a6dd0b-daf1-4cc6-9814-721c446ca190", name: "光阻液", note: "was Photoresist" },
  { id: "d5a86a3c-f547-4b98-b5fc-3774d799d9ad", name: "氮化鎵", note: "was Gallium Nitride" },
  { id: "6b462570-34cf-492b-9fa9-b016a874d0bf", name: "矽光子", note: "was Silicon Photonics" },
  { id: "c0bb22a5-58eb-428a-95b1-39bb8382cc1b", name: "矽晶圓", note: "was Silicon Wafer" },
  { id: "bfdca82f-c141-4aa7-a803-43df36a89d66", name: "碳化矽", note: "was Silicon Carbide" },
  { id: "9f71fc35-32ff-4c9f-99c4-a603d1cd387f", name: "磷化銦", note: "was Indium Phosphide" },
  { id: "32b4bc81-24e6-4100-9c45-6ea00ffed13d", name: "資料中心", note: "was Data Center" },
  { id: "ca395db5-6228-47f0-950f-bf7c9e3226a4", name: "電動車", note: "was EV Supply Chain" },
  { id: "75b19051-23d8-462d-b7e9-4b4bd80c1bb1", name: "低軌衛星", note: "fix garbled name" }
];

// Production themeUpdateInputSchema requires slug field (min(1)) even in partial update.
// Server recalculates slug from createSlug(name), so we just need to pass any non-empty slug
// to pass validation. We use the target slug as hint.
const slugHints: Record<string, string> = {
  "37a6dd0b-daf1-4cc6-9814-721c446ca190": "photoresist",
  "d5a86a3c-f547-4b98-b5fc-3774d799d9ad": "gan",
  "6b462570-34cf-492b-9fa9-b016a874d0bf": "silicon-photonics",
  "c0bb22a5-58eb-428a-95b1-39bb8382cc1b": "silicon-wafer",
  "bfdca82f-c141-4aa7-a803-43df36a89d66": "sic",
  "9f71fc35-32ff-4c9f-99c4-a603d1cd387f": "inp",
  "32b4bc81-24e6-4100-9c45-6ea00ffed13d": "data-center",
  "ca395db5-6228-47f0-950f-bf7c9e3226a4": "ev-supply-chain",
  "75b19051-23d8-462d-b7e9-4b4bd80c1bb1": "leo-satellite"
};

async function main() {
  const lines: string[] = [
    `PATCH theme names to Chinese`,
    `Started: ${new Date().toISOString()}`,
    ``
  ];

  let allOk = true;

  for (const p of patches) {
    const resp = await fetch(`${BASE_URL}/api/v1/themes/${p.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": WORKSPACE
      },
      body: JSON.stringify({ name: p.name, slug: slugHints[p.id] ?? "fix" })
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await resp.json()) as any;
    const resultName: string = body?.data?.name ?? "(no name)";
    const resultSlug: string = body?.data?.slug ?? "(no slug)";
    const ok = resp.status >= 200 && resp.status < 300;
    const line = `status=${resp.status} id=${p.id} name=${resultName} slug=${resultSlug} (${p.note})`;
    console.log(line);
    lines.push(line);
    if (!ok) allOk = false;
    await new Promise((r) => setTimeout(r, 200));
  }

  lines.push("");
  lines.push(`Finished: ${new Date().toISOString()}`);
  lines.push(allOk ? "RESULT: PASS" : "RESULT: FAIL (some patches failed)");

  writeFileSync(
    "evidence_content_sprint_2026-04-23/jason_s4_apply/step1-names-patch-tsx.log",
    lines.join("\n"),
    "utf8"
  );
  console.log("\nLog written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
