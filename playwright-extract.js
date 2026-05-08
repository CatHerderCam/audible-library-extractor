/**
 * Headless Audible extraction + GitHub publish script.
 *
 * Prerequisites:
 *   1. Run `yarn build` (or `npm run build`) to produce dist/
 *   2. Run `node playwright-extract.js`  (or: npm run extract)
 *
 * First run: a browser window opens — log in to Audible when prompted.
 * The session is saved to .playwright-session/ so subsequent runs skip login.
 *
 * Environment variables:
 *   AUDIBLE_DOMAIN   TLD for your Audible region (default: "com")
 *                    e.g.  AUDIBLE_DOMAIN=co.uk
 *   GITHUB_TOKEN     Personal access token for pushing to GitHub.
 *                    Only needed if git push requires authentication
 *                    that isn't already handled by your system credential
 *                    manager or an SSH key.
 *   GITHUB_BRANCH    Branch to push to (default: "main")
 */

import { chromium } from 'playwright';
import { execSync }  from 'node:child_process';
import path          from 'node:path';
import fs            from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load a .env file if present (e.g. GITHUB_TOKEN=ghp_xxx).
// This avoids needing GitKraken's credential store or system git auth.
const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

// ── Configuration ───────────────────────────────────────────────────────────
const AUDIBLE_DOMAIN = process.env.AUDIBLE_DOMAIN  || 'com';
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN    || '';
const GITHUB_BRANCH  = process.env.GITHUB_BRANCH   || 'main';
const REPO_HTTPS_URL = process.env.GITHUB_REPO_URL || '';

const EXTENSION_PATH = path.resolve(__dirname, 'dist');
const SESSION_DIR    = path.resolve(__dirname, '.playwright-session');
const OUTPUT_DIR     = path.resolve(__dirname, 'output');
const REPO_DIR       = path.resolve(__dirname, '.library-repo');
const EXTRACT_DIR    = path.resolve(__dirname, '.gallery-extract');

const AUTH_TIMEOUT_MS    = 5  * 60 * 1000;  // 5 min to log in
const EXTRACT_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min max for extraction
const ZIP_TIMEOUT_MS     = 5  * 60 * 1000;  // 5 min max to build the zip
// ────────────────────────────────────────────────────────────────────────────

function repoUrl() {
  // Embed the token in the URL so git push works without interactive prompts.
  // The token-bearing URL is stored in .library-repo/.git/config (local only,
  // gitignored — never committed to this source repo).
  if (GITHUB_TOKEN) {
    const url = new URL(REPO_HTTPS_URL);
    return `${url.protocol}//x-access-token:${GITHUB_TOKEN}@${url.host}${url.pathname}`;
  }
  return REPO_HTTPS_URL;
}

function git(cmd) {
  execSync(cmd, { cwd: REPO_DIR, stdio: 'inherit' });
}

function gitOut(cmd) {
  return execSync(cmd, { cwd: REPO_DIR }).toString().trim();
}

// ── Step 1: Browser extraction ──────────────────────────────────────────────
async function runExtraction() {
  if (!REPO_HTTPS_URL) {
    console.error('ERROR: GITHUB_REPO_URL is not set. Add it to your .env file.');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    console.error('ERROR: dist/manifest.json not found. Run "yarn build" first.');
    process.exit(1);
  }

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR,  { recursive: true });

  console.log('Launching browser with extension loaded...');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    acceptDownloads: true,
    downloadsPath: OUTPUT_DIR,
  });

  const page = await context.newPage();
  const libraryUrl =
    `https://www.audible.${AUDIBLE_DOMAIN}/library/titles` +
    `?ipRedirectOverride=true&overrideBaseCountry=true`;

  console.log(`Navigating to ${libraryUrl}`);
  await page.goto(libraryUrl);

  // The content script injects a trigger button on library pages only.
  // If not logged in, Audible redirects to the login page — the button won't
  // appear until the user logs in and lands back on a /library/ URL.
  console.log('Waiting for library page... (log in if prompted — 5 min timeout)');
  try {
    await page.waitForSelector('#audible-library-extractor-btn', { timeout: AUTH_TIMEOUT_MS });
  } catch {
    console.error('Timed out. Make sure you log in and reach your library page within 5 minutes.');
    await context.close();
    process.exit(1);
  }

  // Click the injected button to open the extension UI panel.
  console.log('Opening extension UI...');
  await page.click('#audible-library-extractor-btn');

  // The Vue app mounts and shows the extraction menu.
  const extractBtn = page.locator('button.extract.is-info.is-large');
  await extractBtn.waitFor({ state: 'visible', timeout: 15_000 });
  console.log('Starting extraction...');
  await extractBtn.click();

  console.log('Extraction running — waiting for gallery page to open...');
  let galleryPage;
  try {
    galleryPage = await context.waitForEvent('page', {
      predicate: (p) => p.url().includes('gallery.html'),
      timeout: EXTRACT_TIMEOUT_MS,
    });
  } catch {
    console.error('Timed out waiting for the gallery page. Extraction may have failed.');
    await context.close();
    process.exit(1);
  }

  console.log('Gallery opened — waiting for it to finish loading...');
  await galleryPage.waitForLoadState('networkidle', { timeout: 60_000 });

  // The "Save gallery website" option lives in a CSS hover sub-menu under
  // the "Extension Tools" group in the navigation sidebar.
  console.log('Opening the "Save gallery website" dialog...');
  const extensionToolsGroup = galleryPage.locator('.menu-item.extension-tools').first();
  await extensionToolsGroup.waitFor({ state: 'visible', timeout: 15_000 });
  await extensionToolsGroup.hover();

  const saveNavItem = galleryPage.locator('.sub-menu .menu-item-text', {
    hasText: 'Save gallery website',
  });
  await saveNavItem.waitFor({ state: 'visible', timeout: 5_000 });
  await saveNavItem.click();

  const downloadBtn = galleryPage.locator('button.save-btn.save-gallery');
  await downloadBtn.waitFor({ state: 'visible', timeout: 10_000 });

  console.log('Packaging gallery zip (this may take a minute)...');
  const [download] = await Promise.all([
    galleryPage.waitForEvent('download', { timeout: ZIP_TIMEOUT_MS }),
    downloadBtn.click(),
  ]);

  const filename = download.suggestedFilename() || 'ALE-gallery.zip';
  const zipPath  = path.join(OUTPUT_DIR, filename);
  await download.saveAs(zipPath);
  console.log(`Gallery zip saved: ${zipPath}`);

  await context.close();
  return zipPath;
}

// ── Step 2: Publish to GitHub ────────────────────────────────────────────────
function publish(zipPath) {
  console.log('\n── Publishing to GitHub ─────────────────────────────────────');

  // Extract the zip into a temporary directory using PowerShell.
  console.log('Extracting zip...');
  if (fs.existsSync(EXTRACT_DIR)) fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_DIR);
  execSync(
    `powershell -Command "Expand-Archive -Force '${zipPath}' '${EXTRACT_DIR}'"`,
    { stdio: 'inherit' },
  );

  // Clone the repo on first run; afterwards reset it to match the remote so
  // stale cache-busted filenames from previous exports are removed cleanly.
  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    console.log(`Cloning ${REPO_HTTPS_URL} ...`);
    execSync(`git clone "${repoUrl()}" "${REPO_DIR}"`, { stdio: 'inherit' });
  } else {
    console.log('Syncing local repo with remote...');
    // Update remote URL in case the token changed.
    if (GITHUB_TOKEN) {
      execSync(`git remote set-url origin "${repoUrl()}"`, { cwd: REPO_DIR, stdio: 'inherit' });
    }
    git(`git fetch origin`);
    git(`git reset --hard origin/${GITHUB_BRANCH}`);
  }

  // Remove everything except .git/ so stale files from the old export don't linger.
  console.log('Replacing repo contents with new gallery...');
  for (const entry of fs.readdirSync(REPO_DIR)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(REPO_DIR, entry), { recursive: true, force: true });
  }

  // Copy the freshly extracted gallery files into the repo.
  fs.cpSync(EXTRACT_DIR, REPO_DIR, { recursive: true });

  // Stage everything and bail early if nothing changed.
  git('git add -A');
  const changes = gitOut('git status --porcelain');
  if (!changes) {
    console.log('No changes detected — library is already up to date.');
    return;
  }

  const timestamp =
    new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC';
  git(`git commit -m "Update library data: ${timestamp}"`);
  git(`git push origin ${GITHUB_BRANCH}`);

  console.log(`\nPublished! Cloudflare Pages will deploy the new gallery shortly.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const zipPath = await runExtraction();
  publish(zipPath);
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
