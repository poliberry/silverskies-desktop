import type { NormalizedAlert } from "@/types/alerts";

/** Reads an alert aloud via the Web Speech API — cancels any in-flight
 * utterance first so overlapping alerts don't queue indefinitely. A lower
 * pitch/rate than the browser default, closer to a real weather-radio
 * voice, but there's no control over which OS voice actually gets used.
 * Resolves once speech actually finishes (or errors/gets cancelled) so a
 * caller reading multiple alerts in a row can wait for each one instead of
 * firing them back-to-back — speak() itself queues rather than cancelling,
 * but the very next call's own `cancel()` would otherwise cut the previous
 * alert off mid-sentence if the caller didn't wait. */
export function speakAlert(alert: NormalizedAlert): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
  window.speechSynthesis.cancel();

  const body = [alert.headline ?? alert.displayEvent, alert.description].filter(Boolean).join(". ");
  const utterance = new SpeechSynthesisUtterance(body);
  utterance.rate = 0.95;
  utterance.pitch = 0.85;
  return new Promise((resolve) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
