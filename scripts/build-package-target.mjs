import { spawnSync } from 'node:child_process';

const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
const env = {
    ...process.env,
    FFNE_TARGET: target,
};

const npm = npmInvocation(['run', 'build']);
run(npm.command, npm.args, env);
run('node', ['scripts/package-extension.mjs'], env);

function run(command, args, envVars) {
    const result = spawnSync(command, args, {
        env: envVars,
        stdio: 'inherit',
    });

    if (result.error) {
        console.error(result.error);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
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
