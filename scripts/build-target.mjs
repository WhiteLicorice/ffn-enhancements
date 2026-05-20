import { spawnSync } from 'node:child_process';

const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
const npm = npmInvocation(['run', 'build']);
const result = spawnSync(npm.command, npm.args, {
    env: {
        ...process.env,
        FFNE_TARGET: target,
    },
    stdio: 'inherit',
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

function npmInvocation(args) {
    if (process.platform !== 'win32') {
        return { command: 'npm', args };
    }

    return {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', 'npm', ...args],
    };
}
