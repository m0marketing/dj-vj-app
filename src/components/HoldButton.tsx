"use client";

import { useRef } from "react";

interface Props {
  on: boolean;
  /** Called with the new state. */
  onChange: (on: boolean) => void;
  label: React.ReactNode;
  title?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Momentary / latching button. Hold = on while pressed; a quick tap latches it on, and the next tap turns it off.
 * (Pointer events, so it also works for touch and keeps working when the pointer slides off the button.)
 */
export default function HoldButton({ on, onChange, label, title, className = "", ariaLabel }: Props) {
  const t0 = useRef(0);
  const wasOn = useRef(false);
  return (
    <button
      type="button"
      className={`btn touch-none ${on ? "btn-accent" : ""} ${className}`}
      aria-pressed={on}
      aria-label={ariaLabel}
      title={title ? `${title} (押している間 ON / 軽くタップでラッチ、もう一度タップで解除)` : "押している間 ON / 軽くタップでラッチ、もう一度タップで解除"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        wasOn.current = on;
        t0.current = performance.now();
        onChange(!wasOn.current);
      }}
      onPointerUp={() => {
        if (!wasOn.current && performance.now() - t0.current > 350) onChange(false);
      }}
      onPointerCancel={() => onChange(false)}
    >
      {label}
    </button>
  );
}
