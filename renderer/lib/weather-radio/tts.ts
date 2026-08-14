import type { NormalizedAlert } from "@/types/alerts";

/** Reads an alert aloud via the Web Speech API — cancels any in-flight
 * utterance first so overlapping alerts don't queue indefinitely. A lower
 * pitch/rate than the browser default, closer to a real weather-radio
 * voice, but there's no control over which OS voice actually gets used. */
export function speakAlert(alert: NormalizedAlert): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const body = [alert.headline ?? alert.displayEvent, alert.description].filter(Boolean).join(". ");
  const utterance = new SpeechSynthesisUtterance(body);
  utterance.rate = 0.95;
  utterance.pitch = 0.85;
  window.speechSynthesis.speak(utterance);
}
