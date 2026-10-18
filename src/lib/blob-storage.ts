/** Binary fallback for WebKit environments that cannot persist Blob/File objects in IndexedDB. */
export interface StoredBlob {
  format: "djvj-blob-v1";
  data: ArrayBuffer;
  type: string;
}

export async function packBlob(blob: Blob): Promise<StoredBlob> {
  return { format: "djvj-blob-v1", data: await blob.arrayBuffer(), type: blob.type };
}

export function unpackBlob(value: unknown): unknown {
  if (value && typeof value === "object") {
    const packed = value as Partial<StoredBlob>;
    if (packed.format === "djvj-blob-v1" && packed.data instanceof ArrayBuffer && typeof packed.type === "string") {
      return new Blob([packed.data], { type: packed.type });
    }
  }
  return value;
}

export function blobStorageFailed(error: unknown) {
  const failure = error as { name?: string; message?: string } | null;
  return !!failure && ["UnknownError", "DataCloneError"].includes(failure.name ?? "") && /blob|file data/i.test(failure.message ?? "");
}
