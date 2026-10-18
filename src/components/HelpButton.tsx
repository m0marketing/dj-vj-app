"use client";

import { useDJ, type HelpSection } from "@/lib/store";

/** Small "?" next to a panel title that opens the matching page of the help overlay (works on touch, unlike tooltips). */
export default function HelpButton({ section }: { section: HelpSection }) {
  const openHelp = useDJ((s) => s.openHelp);
  return (
    <button type="button" className="grid h-5 w-5 place-items-center rounded-full border border-border text-[10px] text-zinc-400 hover:border-accent hover:text-accent" onClick={() => openHelp(section)} aria-label="このパネルの使い方" title="使い方">
      ?
    </button>
  );
}
