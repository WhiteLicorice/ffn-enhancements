const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';

    for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
    }

    return btoa(binary);
}

export function base64ToBytes(dataBase64: string): Uint8Array {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}
