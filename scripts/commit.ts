#!/usr/bin/env zx

import 'zx/globals';

$.env.FORCE_COLOR = "1";

await $`git rev-parse --is-inside-work-tree`;

// Safety: ensure we are on main
const branch = (await $`git branch --show-current`).stdout.trim();
if (branch !== 'main') {
  console.log(chalk.black.bgRed("You must be on 'main' branch (currently: ${branch})`"));
  process.exit(0);
}

await $`pnpm process`.verbose();

await $`git add data/`.verbose();

console.log('\n');

// Check if anything changed
try {
  await $`git diff --cached --quiet`;
  console.log(chalk.green('Nothing to commit.'));
  process.exit(0);
} catch {}

const date = new Date().toISOString().slice(0, 10);

console.log(chalk.green('Committing changes'));

await $({ verbose: true })`git commit -m ${`Update music [${date}]`}`;

console.log('\n');
console.log(chalk.cyan('Music committed\n'));
