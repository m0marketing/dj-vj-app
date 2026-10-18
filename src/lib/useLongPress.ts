"use client";

import { useRef } from "react";

/**
 * Tap vs. long-press (default 550 ms) on one element; also maps right-click to the long-press action
 * so mouse users keep a quick path. Touch devices get haptic feedback where supported.
 */
export function useLongPress(onTap: () => void, onLong: () => void, ms = 550) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(15);
        onLong();
      }, ms);
    },
    onPointerUp: () => {
      const was = timer.current != null;
      clear();
      if (was && !fired.current) onTap();
    },
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      onLong();
    },
  };
}
