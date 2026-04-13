import { AppShell } from "@/components/app-shell";
import { ThemeBoard } from "@/components/theme-board";

export default function ThemesPage() {
  return (
    <AppShell eyebrow="Theme Board" title="Theme Research">
      <ThemeBoard />
    </AppShell>
  );
}
