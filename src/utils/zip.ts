import {
    strFromU8,
    strToU8,
    unzipSync,
    Zip,
    ZipDeflate,
    ZipPassThrough,
    type ZipOptions,
} from 'fflate';

export interface ZipFileEntry {
    path: string;
    data: Uint8Array;
    options?: ZipOptions;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
    // Always materialize a fresh content-realm Uint8Array so downstream ZIP and
    // XML code never receives a wrapped cross-realm view from browser APIs.
    return new Uint8Array(await blob.arrayBuffer());
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    // Copy into a fresh ArrayBuffer so the result always satisfies BlobPart typing.
    return new Uint8Array(bytes).buffer;
}

export function textToBytes(text: string): Uint8Array {
    return strToU8(text);
}

export function bytesToText(bytes?: Uint8Array | null): string {
    return bytes ? strFromU8(bytes) : '';
}

export function createZip(entries: ZipFileEntry[], defaultOptions?: ZipOptions): Uint8Array {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
        if (error) throw error;
        chunks.push(chunk);
    });

    for (const entry of entries) {
        const options = { ...defaultOptions, ...entry.options };
        const file = createZipFile(entry.path, options);
        applyZipAttributes(file, options);
        zip.add(file);
        file.push(entry.data, true);
    }

    zip.end();

    return concatBytes(chunks);
}

export function unzipBytes(data: Uint8Array): Record<string, Uint8Array> {
    const files = unzipSync(data);
    const normalized: Record<string, Uint8Array> = {};

    for (const [path, bytes] of Object.entries(files)) {
        normalized[path.endsWith('/') ? path.slice(0, -1) : path] = bytes;
    }

    return normalized;
}

function createZipFile(path: string, options: ZipOptions): ZipPassThrough | ZipDeflate {
    if (options.level === 0) {
        return new ZipPassThrough(path);
    }

    return new ZipDeflate(path, options);
}

function applyZipAttributes(file: ZipPassThrough | ZipDeflate, options: ZipOptions): void {
    if (options.mtime) file.mtime = options.mtime;
    if (options.os !== undefined) file.os = options.os;
    if (options.attrs !== undefined) file.attrs = options.attrs;
    if (options.comment !== undefined) file.comment = options.comment;
    if (options.extra !== undefined) file.extra = options.extra;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }

    return out;
}
