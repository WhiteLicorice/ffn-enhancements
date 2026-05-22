export function getBuildTarget(): 'chrome' | 'firefox';
export function getOutDir(): string;
export function copyDirRecursive(src: string, dest: string): void;
export function patchManifest(manifestPath: string): void;
