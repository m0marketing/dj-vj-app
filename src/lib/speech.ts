"use client";

const PREFERRED = ["Otoya", "Kyoko", "Google 日本語", "Microsoft Ichiro", "Microsoft Haruka"];

function pickVoice() {
  const ja = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ja"));
  return ja.find((v) => PREFERRED.some((p) => v.name.includes(p))) ?? ja[0] ?? null;
}

/** Reads a catchphrase with the browser's Japanese voice (plays on the system output, not through the mixer). */
export function speak(text: string, semitones = 0, volume = 1) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = "ja-JP";
  u.rate = 1.1;
  u.pitch = Math.min(2, Math.max(0.1, 1.1 * Math.pow(2, semitones / 12)));
  u.volume = Math.min(1, volume);
  synth.speak(u);
}
