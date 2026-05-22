import { installBootstrap } from './bootstrap';
import { Core } from './modules/Core';

const BOOTSTRAP_FLAG = '__ffneContentBootstrapped';
const contentGlobal = globalThis as typeof globalThis & Record<string, boolean | undefined>;

if (!contentGlobal[BOOTSTRAP_FLAG]) {
    contentGlobal[BOOTSTRAP_FLAG] = true;

    window.addEventListener('error', (e) => {
        Core.log('main', 'globalError', 'Unhandled runtime error:', e.error || e.message);
    });

    installBootstrap(window.location, document);
}
