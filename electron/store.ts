import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ConfigFile,
  DEFAULT_CONFIG,
  DEFAULT_LOCATIONS,
  LocationsFile,
} from "./types";

function userDataDir(): string {
  return app.getPath("userData");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Write-to-temp-then-rename so a crash/power-loss mid-write can't leave a
 * half-written, unparsable JSON file behind. */
async function writeJsonAtomic(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function readJsonWithDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

class JsonStore<T extends object> {
  private cache: T | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fileName: string,
    private readonly fallback: T,
  ) {}

  private filePath(): string {
    return path.join(userDataDir(), this.fileName);
  }

  async read(): Promise<T> {
    if (this.cache) return this.cache;
    const data = await readJsonWithDefault(this.filePath(), this.fallback);
    this.cache = data;
    return data;
  }

  async write(data: T): Promise<T> {
    this.cache = data;
    // Serialize writes so rapid-fire updates (e.g. dragging a slider) can't
    // race and corrupt the file with an out-of-order rename.
    this.writeQueue = this.writeQueue.then(() => writeJsonAtomic(this.filePath(), data));
    await this.writeQueue;
    return data;
  }

  async update(mutator: (current: T) => T): Promise<T> {
    const current = await this.read();
    const next = mutator(current);
    return this.write(next);
  }
}

export const locationsStore = new JsonStore<LocationsFile>("locations.json", DEFAULT_LOCATIONS);
export const configStore = new JsonStore<ConfigFile>("config.json", DEFAULT_CONFIG);
