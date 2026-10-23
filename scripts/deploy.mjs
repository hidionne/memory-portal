// Publishes the current branch to GitHub Pages, each branch in its own folder:
//
//   https://<owner>.github.io/<repo>/<branch>/
//
// so every version of the site stays online side by side. The site root gets
// a small index page linking to all published versions.
//
//   npm run deploy            build + publish the current branch
//   npm run deploy -- --force publish even with uncommitted changes
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const branch = run('git rev-parse --abbrev-ref HEAD');
if (branch === 'HEAD' || branch === 'gh-pages') {
  console.error(`[deploy] check out a version branch first (currently on "${branch}").`);
  process.exit(1);
}
if (run('git status --porcelain') && !process.argv.includes('--force')) {
  console.error('[deploy] you have uncommitted changes. Commit them first (or pass --force).');
  process.exit(1);
}

const remote = run('git remote get-url origin');
const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
if (!match) {
  console.error(`[deploy] origin (${remote}) is not a GitHub repository.`);
  process.exit(1);
}
const [, owner, repo] = match;
const folder = branch.replace(/[^a-zA-Z0-9._-]+/g, '-');
const sha = run('git rev-parse --short HEAD');

console.log(`[deploy] building ${branch} @ ${sha}`);
sh('npm run build');

const work = mkdtempSync(join(tmpdir(), 'memory-portal-pages-'));
try {
  const hasPages = run('git ls-remote --heads origin gh-pages') !== '';
  if (hasPages) {
    sh(`git fetch origin gh-pages`);
    sh(`git worktree add --force -B gh-pages "${work}" origin/gh-pages`);
  } else {
    sh(`git worktree add --detach "${work}"`);
    sh('git checkout --orphan gh-pages', { cwd: work });
    sh('git rm -rf --quiet .', { cwd: work });
  }

  rmSync(join(work, folder), { recursive: true, force: true });
  cpSync('dist', join(work, folder), { recursive: true });
  writeFileSync(join(work, '.nojekyll'), '');

  const versions = readdirSync(work)
    .filter((d) => !d.startsWith('.') && statSync(join(work, d)).isDirectory() && existsSync(join(work, d, 'index.html')))
    .sort();
  writeFileSync(join(work, 'index.html'), indexPage(repo, versions));

  sh('git add -A', { cwd: work });
  if (run('git status --porcelain', { cwd: work })) {
    sh(`git commit --quiet -m "Deploy ${branch} @ ${sha}"`, { cwd: work });
    sh('git push origin gh-pages', { cwd: work });
  } else {
    console.log('[deploy] nothing changed.');
  }
  console.log(`\n[deploy] live (give GitHub a minute): https://${owner}.github.io/${repo}/${folder}/`);
  console.log(`[deploy] all versions:               https://${owner}.github.io/${repo}/`);
} finally {
  try {
    sh(`git worktree remove --force "${work}"`);
  } catch {
    rmSync(work, { recursive: true, force: true });
  }
}

function indexPage(title, versions) {
  const colours = ['#f0559c', '#ff8f2e', '#3b86de', '#47a84a', '#9653d3', '#e4463a'];
  const items = versions
    .map((v, i) => `<li><a href="./${v}/" style="background:${colours[i % colours.length]}">${v.replace(/-/g, ' ')}</a></li>`)
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fcf6e8;
        font: 24px 'Chalkboard SE', 'Comic Sans MS', cursive; color: #2c5aa8; }
      main { padding: 32px; text-align: center; }
      h1 { font-size: 46px; margin: 0 0 24px; transform: rotate(-2deg); }
      ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 16px; }
      a { display: inline-block; padding: 10px 26px 12px; color: #fffaf0; text-decoration: none;
        border-radius: 255px 14px 225px 14px / 14px 225px 14px 255px; outline: 2px dashed rgba(255,250,240,.7);
        outline-offset: -7px; transform: rotate(-1deg); }
      li:nth-child(even) a { transform: rotate(1.5deg); }
    </style>
  </head>
  <body>
    <main>
      <h1>${title.replace(/-/g, ' ')}</h1>
      <ul>
      ${items}
      </ul>
    </main>
  </body>
</html>
`;
}
