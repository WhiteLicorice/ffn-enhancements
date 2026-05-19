export {};

declare global {
    // JSZip 3.1.5 supports "string" as an alias for "text" at runtime,
    // but @types/jszip 3.1.5 omits it from OutputByType.
    interface OutputByType {
        string: string;
    }
}
