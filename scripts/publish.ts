#!/usr/bin/env zx

import 'zx/globals';

$.env.FORCE_COLOR = "1";

await $`pnpm commit`;

console.log('\n');
console.log('\n');
console.log(
  chalk.black.bgRed('(!)'),
  chalk.red('PUSHING CHANGES TO PRODUCTION\n'),
);

await $`git fetch origin`;

await $`git switch main`;
await $({ verbose: true })`git push origin main`;

await $`git switch prod`;

console.log("Fast Forwarding Prod");
await $({ verbose: true })`git merge --ff-only main`;

console.log("Pushing to prod");
await $({ verbose: true })`git push origin prod`;

await $`git switch main`;

console.log('\n');
console.log(chalk.cyan('Music published\n'));