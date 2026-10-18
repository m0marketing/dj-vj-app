import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PadConfig, SampleMeta, SampleRecord, TrackMeta, TrackRecord } from "./types";
import { blobStorageFailed, packBlob, unpackBlob, type StoredBlob } from "./blob-storage";

type StoredRecord<T extends { blob: Blob }> = Omit<T, "blob"> & { blob: Blob | StoredBlob };
const unpackRecord = <T extends { blob: unknown }>(rec: T) => ({ ...rec, blob: unpackBlob(rec.blob) as Blob });

interface DJDB extends DBSchema {
  tracks: { key: string; value: StoredRecord<TrackRecord>; indexes: { createdAt: number } };
  samples: { key: string; value: StoredRecord<SampleRecord>; indexes: { createdAt: number } };
  pads: { key: number; value: PadConfig };
  settings: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<DJDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<DJDB>("dj-vj-app", 1, {
      upgrade(db) {
        db.createObjectStore("tracks", { keyPath: "id" }).createIndex("createdAt", "createdAt");
        db.createObjectStore("samples", { keyPath: "id" }).createIndex("createdAt", "createdAt");
        db.createObjectStore("pads", { keyPath: "index" });
        db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

// Remember the capability for this page; do not retry a failed Blob write for every kit sound.
let packBinary = false;
async function putAudio(store: "tracks" | "samples", rec: TrackRecord | SampleRecord) {
  const database = await getDB();
  if (!packBinary) {
    try { await database.put(store, rec); return; }
    catch (error) { if (!blobStorageFailed(error)) throw error; packBinary = true; }
  }
  await database.put(store, { ...rec, blob: await packBlob(rec.blob) });
}

export function stripBlob<T extends { blob: unknown }>(rec: T): Omit<T, "blob"> {
  const copy: Partial<T> = { ...rec };
  delete copy.blob;
  return copy as Omit<T, "blob">;
}

export const db = {
  async listTracks(): Promise<TrackMeta[]> {
    const all = await (await getDB()).getAllFromIndex("tracks", "createdAt");
    return all.map(stripBlob).reverse();
  },
  async getTrack(id: string) {
    const rec = await (await getDB()).get("tracks", id);
    return rec ? unpackRecord(rec) : undefined;
  },
  async putTrack(track: TrackRecord) {
    await putAudio("tracks", track);
  },
  async updateTrack(id: string, patch: Partial<TrackMeta>) {
    // Read-modify-write inside ONE readwrite transaction: several analyses (BPM, key, loudness, chorus, vocals)
    // patch the same record concurrently, and separate get/put calls would lose updates to each other.
    const d = await getDB();
    const tx = d.transaction("tracks", "readwrite");
    const t = await tx.store.get(id);
    if (t) await tx.store.put({ ...t, ...patch });
    await tx.done;
  },
  async deleteTrack(id: string) {
    await (await getDB()).delete("tracks", id);
  },

  async listSamples(): Promise<SampleMeta[]> {
    const all = await (await getDB()).getAllFromIndex("samples", "createdAt");
    return all.map(stripBlob).reverse();
  },
  async getSample(id: string) {
    const rec = await (await getDB()).get("samples", id);
    return rec ? unpackRecord(rec) : undefined;
  },
  async putSample(sample: SampleRecord) {
    await putAudio("samples", sample);
  },
  async deleteSample(id: string) {
    await (await getDB()).delete("samples", id);
  },

  async listPads(): Promise<PadConfig[]> {
    return (await getDB()).getAll("pads");
  },
  async putPad(pad: PadConfig) {
    await (await getDB()).put("pads", pad);
  },

  async getSetting<T>(key: string): Promise<T | undefined> {
    return unpackBlob(await (await getDB()).get("settings", key)) as T | undefined;
  },
  async setSetting(key: string, value: unknown) {
    const database = await getDB();
    if (value instanceof Blob) {
      if (!packBinary) {
        try { await database.put("settings", value, key); return; }
        catch (error) { if (!blobStorageFailed(error)) throw error; packBinary = true; }
      }
      await database.put("settings", await packBlob(value), key);
    } else await database.put("settings", value, key);
  },
  async deleteSetting(key: string) {
    await (await getDB()).delete("settings", key);
  },

  /** Full records (with blobs) for backup. */
  async allTrackRecords(): Promise<TrackRecord[]> {
    return (await (await getDB()).getAll("tracks")).map(unpackRecord);
  },
  async allSampleRecords(): Promise<SampleRecord[]> {
    return (await (await getDB()).getAll("samples")).map(unpackRecord);
  },
  async allSettings(): Promise<Record<string, unknown>> {
    const d = await getDB();
    const keys = await d.getAllKeys("settings");
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = unpackBlob(await d.get("settings", k));
    return out;
  },
  async clearAll() {
    const d = await getDB();
    await Promise.all([d.clear("tracks"), d.clear("samples"), d.clear("pads"), d.clear("settings")]);
  },

  /** Browser storage usage; `persisted` = the browser promised not to evict us under pressure. */
  async storageInfo() {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  },
  async requestPersist() {
    return (await navigator.storage?.persist?.()) ?? false;
  },
};
