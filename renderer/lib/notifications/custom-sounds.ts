// User-supplied notification sounds, stored as data URLs in localStorage
// rather than config.json — an audio file doesn't belong in a settings file
// that's rewritten on every toggle. Every window shares this storage (same
// origin), so the main window's watcher and a pop-up window both see it.

export type SoundTier = "advisory" | "severe";

export interface CustomSound {
  name: string;
  dataUrl: string;
}

/** Keeps well inside localStorage's ~5 MB per-origin budget with room for
 * both tiers plus everything else the app stores there. */
export const MAX_CUSTOM_SOUND_BYTES = 1.5 * 1024 * 1024;

const key = (tier: SoundTier) => `silverskies.customSound.${tier}`;

export function getCustomSound(tier: SoundTier): CustomSound | null {
  try {
    const raw = localStorage.getItem(key(tier));
    return raw ? (JSON.parse(raw) as CustomSound) : null;
  } catch {
    return null;
  }
}

export function clearCustomSound(tier: SoundTier): void {
  localStorage.removeItem(key(tier));
}

/** Reads the file and stores it. Throws a user-presentable Error on a file
 * that's too large, not audio, or that storage refuses. */
export async function setCustomSound(tier: SoundTier, file: File): Promise<CustomSound> {
  if (!file.type.startsWith("audio/")) throw new Error("That file isn't an audio file.");
  if (file.size > MAX_CUSTOM_SOUND_BYTES) throw new Error("Keep custom sounds under 1.5 MB — a few seconds is plenty.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
  const sound = { name: file.name, dataUrl };
  try {
    localStorage.setItem(key(tier), JSON.stringify(sound));
  } catch {
    throw new Error("Not enough storage for that file — try a shorter clip.");
  }
  return sound;
}
