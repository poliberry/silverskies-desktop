/** Synthesizes the standard NOAA/EAS two-tone SAME attention signal — 853Hz
 * and 960Hz simultaneously, the same tone real NOAA Weather Radio receivers
 * play to grab attention right before a voice message — via plain
 * OscillatorNodes. Resolves once the tone has finished playing. */
export function synthesizeSameAttentionTone(ctx: AudioContext, durationSec = 8): Promise<void> {
  return new Promise((resolve) => {
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 853;
    osc1.connect(gain);

    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 960;
    osc2.connect(gain);

    const now = ctx.currentTime;
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationSec);
    osc2.stop(now + durationSec);
    osc2.onended = () => resolve();
  });
}
