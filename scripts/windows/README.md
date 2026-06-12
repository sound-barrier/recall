# scripts/windows/

`Reset-Database.bat` — a maintenance helper for **Windows desktop users**
of Recall. It uses **only file operations** (no `sqlite3`, no other
dependency — the Recall app embeds its own pure-Go SQLite).

This same script ships two ways for end users: bundled into the Windows
installer at `C:\Program Files\recall\Reset-Database.bat`, and as a
signed release asset (`recall-<version>-Reset-Database.bat`) on the
[Releases](https://github.com/sound-barrier/recall/releases) page. See
`docs/install-windows.md` → "Resetting your database".

## What it does

Recall has **no schema migrations** pre-1.0: it recreates an empty
database on next launch and re-parses your screenshots folder. So
"cleaning the database" just means deleting the `recall.db` trio (the
`.db` plus its `-wal` / `-shm` WAL sidecars); the app rebuilds it. Use it
when an update made your local data incompatible, the database is
corrupt, or you want a fresh start.

It **backs up the database first** (to `…\db\backups\recall-<timestamp>.db`)
and asks you to confirm before deleting.

| Run it | Behaviour |
|---|---|
| double-click `Reset-Database.bat` | warn → confirm → back up → delete |
| `Reset-Database.bat /force` | skip the confirmation prompt |
| `Reset-Database.bat /nobackup` | delete without backing up first |

**Close Recall first** — a reset while the app is mid-write can leave a
torn `-wal`. The script warns you if Recall looks like it's running.

**To restore a backup later:** copy the `recall-<timestamp>.db` trio from
`…\db\backups\` back over `recall.db` (and its `-wal` / `-shm`) while
Recall is closed.

## What is lost vs. safe

| Lost (lives ONLY in the database) | Safe (untouched) |
|---|---|
| match notes, tags, tagged teammates | your screenshots folder |
| leaver flags, replay codes | `settings.json` (incl. the screenshots path) |
| review state, queue / play-mode overrides | other profiles |
| hidden-match flags | |

## Where the data lives

By default the active profile's database is at:

```text
%AppData%\Recall\profiles\<active-profile>\db\recall.db
```

The script resolves `<active-profile>` from `profiles.json` (falling back
to `main`), mirroring the app (`pkg/app/settings.go` + `profile.go`).
Three environment variables override the resolution for a non-standard
install (same names + precedence the app uses):

| Variable | Effect |
|---|---|
| `RECALL_DB` | Full path straight to the `.db` file. |
| `RECALL_PROFILE` | Operate on a specific profile instead of the active one. |
| `RECALL_DATA_DIR` | Full path to the install base (the parent of `profiles\`). |

> **macOS / Linux** users have no `.bat`: close Recall and delete
> `recall.db` (plus `-wal` / `-shm`) under the app-data dir to reset.
