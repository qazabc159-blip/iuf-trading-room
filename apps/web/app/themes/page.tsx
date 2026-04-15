import { AppShell } from "@/components/app-shell";
import { ThemeBoard } from "@/components/theme-board";

export default function ThemesPage() {
  return (
    <AppShell eyebrow="主題戰區" title="投研主題管理">
      <ThemeBoard />
    </AppShell>
  );
}
