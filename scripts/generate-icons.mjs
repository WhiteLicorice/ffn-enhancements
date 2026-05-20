// Generates placeholder extension icons (solid navy squares).
// Replace with proper icons before store submission.

import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'dist', 'icons');

function createPNG(size) {
    // Build a minimal solid-color PNG (navy #29297a).
    const COLOR = [0x29, 0x29, 0x7a];
    const width = size;
    const height = size;

    // Raw image data (filter byte 0 + RGB per row)
    const rawRows = [];
    for (let y = 0; y < height; y++) {
        rawRows.push(0); // filter: none
        for (let x = 0; x < width; x++) {
            rawRows.push(COLOR[0], COLOR[1], COLOR[2]);
        }
    }
    const raw = Buffer.from(rawRows);

    // DEFLATE the raw data
    // Use a simple uncompressed DEFLATE block (BTYPE=00)
    const rawLen = raw.length;
    const deflateData = [];
    // BFINAL=1, BTYPE=00
    deflateData.push(0x01); // [BFINAL=1][BTYPE=00]
    // LEN (2 bytes, little-endian)
    deflateData.push(rawLen & 0xff, (rawLen >> 8) & 0xff);
    // NLEN (2 bytes, one's complement)
    const nlen = rawLen ^ 0xffff;
    deflateData.push(nlen & 0xff, (nlen >> 8) & 0xff);
    // Raw data follows
    for (let i = 0; i < raw.length; i++) deflateData.push(raw[i]);

    const compressed = Buffer.from(deflateData);

    // CRC32 helper
    function crc32(buf) {
        let crc = 0xffffffff;
        const table = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c;
        }
        for (let i = 0; i < buf.length; i++) {
            crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    function chunk(type, data) {
        const typeBytes = Buffer.from(type, 'ascii');
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const crcData = Buffer.concat([typeBytes, data]);
        const crcVal = Buffer.alloc(4);
        crcVal.writeUInt32BE(crc32(crcData), 0);
        return Buffer.concat([len, typeBytes, data, crcVal]);
    }

    // IHDR
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);  // width
    ihdrData.writeUInt32BE(height, 4); // height
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 2;  // color type (RGB)
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace

    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = chunk('IHDR', ihdrData);
    const idat = chunk('IDAT', compressed);
    const iend = chunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
}

for (const size of [16, 48, 128]) {
    const png = createPNG(size);
    const path = join(ICONS_DIR, `icon-${size}.png`);
    createWriteStream(path).end(png);
    console.log(`Created ${path} (${png.length} bytes)`);
}
