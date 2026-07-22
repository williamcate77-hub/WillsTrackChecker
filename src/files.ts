// Collect File objects from a drag-and-drop, walking into dropped folders.

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FileSystemEntryLike[]) => void, err: (e: unknown) => void) => void;
  };
}

function readEntryFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null);
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

function readDir(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => {
    const reader = entry.createReader?.();
    if (!reader) return resolve([]);
    const all: FileSystemEntryLike[] = [];
    const readBatch = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) return resolve(all);
          all.push(...entries);
          readBatch(); // readEntries returns at most 100 at a time
        },
        () => resolve(all),
      );
    };
    readBatch();
  });
}

async function walk(entry: FileSystemEntryLike, out: File[]): Promise<void> {
  if (entry.isFile) {
    const f = await readEntryFile(entry);
    if (f) out.push(f);
  } else if (entry.isDirectory) {
    const entries = await readDir(entry);
    for (const child of entries) await walk(child, out);
  }
}

export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  const entrySupported =
    items && items.length > 0 && typeof (items[0] as unknown as { webkitGetAsEntry?: unknown }).webkitGetAsEntry === "function";

  if (entrySupported) {
    const entries: FileSystemEntryLike[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as unknown as { webkitGetAsEntry: () => FileSystemEntryLike | null }).webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    const out: File[] = [];
    for (const entry of entries) await walk(entry, out);
    return out;
  }

  return Array.from(dt.files);
}
