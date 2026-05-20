import { installBootstrap } from './bootstrap';
import { Core } from './modules/Core';

window.addEventListener('error', (e) => {
    Core.log('main', 'globalError', 'Unhandled runtime error:', e.error || e.message);
});

installBootstrap(window.location, document);
