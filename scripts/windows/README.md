# scripts/windows/

Maintenance helpers for **Windows desktop users** of Recall. Unlike the
rest of `scripts/` (developer tooling, bash + `sqlite3`), these are
PowerShell scripts that use **only file operations** — no `sqlite3` and
no other dependency, since the Recall app embeds its own pure-Go SQLite.

Each `.ps1` has a matching `.cmd` you can **double-click**; the `.cmd`
just launches the `.ps1` with the execution policy bypassed so you don't
have to change any system setting.

| Script | What it does |
|---|---|
| `Reset-Database` | Wipe the database (delete `recall.db`). Recall rebuilds an empty one on next launch — use it for a clean start or to clear a corrupt DB. `-Backup` saves a copy first; `-Force` skips the prompt. |
| `Backup-Database` | Save a timestamped copy of the database under `…\db\backups\`. `-To <folder>` picks a different destination. |
| `Restore-Database` | Restore the database from a backup — lists what's in `…\db\backups\` and asks which, or pass `-BackupFile <path>`. |
| `Open-Data-Folder` | Open the active profile's data folder (`db\`, `screenshots\`, settings) in File Explorer. |

## Running them

- **Easiest:** double-click the `.cmd` (e.g. `Reset-Database.cmd`).
- **From a terminal:** `powershell -ExecutionPolicy Bypass -File .\Reset-Database.ps1`
- **Right-click** the `.ps1` → *Run with PowerShell*.

**Close Recall first** before resetting, backing up, or restoring — a
copy taken while the app is writing can be inconsistent. The scripts
warn you if Recall looks like it's running.

## Where the data lives

By default the active profile's database is at:

```text
%AppData%\Recall\profiles\<active-profile>\db\recall.db
```

The scripts resolve `<active-profile>` from `profiles.json` (falling back
to `main`), mirroring what the app does. Three environment variables
override the resolution if your install is non-standard (same names the
developer bash scripts use):

| Variable | Effect |
|---|---|
| `RECALL_DATA_DIR` | Full path to the install base (the parent of `profiles\`). |
| `RECALL_PROFILE` | Operate on a specific profile instead of the active one. |
| `RECALL_DB` | Full path straight to the `.db` file. |
