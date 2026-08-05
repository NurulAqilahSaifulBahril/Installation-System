const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const packOnly = args.has('--dir');
const tempOutputDir = 'C:/tmp/installation-system-release';

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const code = result.status ?? 1;
    process.exit(code);
  }
}

removeIfExists(path.join(rootDir, '.next-build'));
removeIfExists(tempOutputDir);

run(process.execPath, [path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build']);

const builderArgs = ['--win', 'nsis'];
if (packOnly) {
  builderArgs.push('--dir');
}

run(process.execPath, [path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), ...builderArgs]);
