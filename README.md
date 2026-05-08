# Audible Library Extractor — Automated Export

This is a fork of [joonaspaakko/audible-library-extractor](https://github.com/joonaspaakko/audible-library-extractor) with an added automation script that extracts your Audible library and publishes it as a static gallery to GitHub (with optional Cloudflare Pages deployment) on a schedule — no manual clicking required.

---

## What it does

1. Opens a headless Chromium browser with the extension loaded
2. Navigates to your Audible library and runs the extraction
3. Downloads the standalone gallery as a zip
4. Pushes the gallery files to a GitHub repository
5. (Optional) Cloudflare Pages automatically deploys from that repository

---

## Prerequisites

- [Node.js](https://nodejs.org/) (any recent LTS)
- [Git for Windows](https://git-scm.com/download/win) (provides Git Bash, required for the build)
- A GitHub repository to publish the gallery to
- A [GitHub Personal Access Token](https://github.com/settings/tokens) with write access to that repository

---

## Setup

### 1. Install dependencies

```powershell
npm install
npx playwright install chromium
```

### 2. Configure your environment

Copy the example env file and fill in your values:

```powershell
copy .env.example .env
```

Open `.env` and set the two required variables:

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub Personal Access Token (see below) |
| `GITHUB_REPO_URL` | HTTPS URL of the repo to publish to, e.g. `https://github.com/your-username/your-repo.git` |

Optional variables (leave commented out to use defaults):

| Variable | Default | Description |
|---|---|---|
| `AUDIBLE_DOMAIN` | `com` | Audible region TLD — e.g. `co.uk`, `de`, `co.jp` |
| `GITHUB_BRANCH` | `main` | Branch to push the gallery to |

#### Creating a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Under **Repository access**, select **Only select repositories** and choose your gallery repo
4. Under **Permissions**, set **Contents** to **Read and write**
5. Generate and copy the token into your `.env` file

### 3. Build the extension

```powershell
npm run build
```

> **Note:** This must be re-run whenever you pull updates to the extension source.

---

## Running the script

```powershell
node playwright-extract.js
```

Or via npm:

```powershell
npm run extract
```

**First run:** A browser window will open. If you are not logged into Audible, log in and wait to be redirected to your library page. The script takes over from there automatically.

**Subsequent runs:** Your session is saved in `.playwright-session/` so no login is needed.

The script will:
- Click the extension button and start the library extraction
- Wait for the gallery page to open (up to 30 minutes for large libraries)
- Package and download `ALE-gallery.zip`
- Clone your GitHub repo (first run) or reset it to match the remote (subsequent runs)
- Replace the repo contents with the new gallery files and push

---

## Scheduling automatic weekly runs

A Windows Task Scheduler task can be created to run the extraction automatically. The following PowerShell command creates a task that runs every **Monday at 1 PM** and catches up if the machine was off at that time:

```powershell
$nodePath = (where.exe node | Select-Object -First 1).Trim()
$action   = New-ScheduledTaskAction -Execute $nodePath -Argument "playwright-extract.js" -WorkingDirectory "C:\path\to\audible-library-extractor"
$trigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "13:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -RunOnlyIfNetworkAvailable
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "AudibleLibraryExtract" -TaskPath "\AudibleLibrary\" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
```

> **Note:** The script opens a real browser window, so the machine must be logged in when the task runs. It cannot run fully headless due to a Chrome extension limitation.

To run the task manually at any time:

```powershell
Start-ScheduledTask -TaskPath "\AudibleLibrary\" -TaskName "AudibleLibraryExtract"
```

---

## Cloudflare Pages deployment

1. Create a new Cloudflare Pages project connected to your gallery GitHub repository
2. Set the build command to **none** (the repo contains pre-built static files)
3. Set the output directory to `/` (root)

Every push from the extraction script will trigger a new deployment automatically.

---

## Project structure

```
.env                      # Your local config (gitignored — never commit this)
.env.example              # Template — copy to .env and fill in your values
playwright-extract.js     # Automation script
.playwright-session/      # Saved browser session (gitignored)
output/                   # Downloaded gallery zips (gitignored)
.library-repo/            # Local clone of your gallery repo (gitignored)
.gallery-extract/         # Temporary extraction directory (gitignored)
src/                      # Extension source code
dist/                     # Built extension (gitignored)
```

---

## Original project

This repository is a fork of **[audible-library-extractor](https://github.com/joonaspaakko/audible-library-extractor)** by [joonaspaakko](https://github.com/joonaspaakko).

All credit for the extension itself — the library scraping, gallery UI, and export functionality — belongs to the original author. This fork adds only the `playwright-extract.js` automation script and related configuration.

For documentation on the extension's features (gallery sharing, CSV export, etc.) see the [original project docs](https://joonaspaakko.gitbook.io/audible-library-extractor/).
