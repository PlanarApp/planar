---
title: Backups and upgrades
description: Backup, restore and upgrade with rollback
---

# Backups and restore

Data (the `PLANAR_DATA_DIR` directory, default `./data`): the database (`postgres`, via `pg_dump`) and the files (`api`) are in the backup; `caddy` and `ai-work` are not (Caddy obtains certificates again).

## Backup

```bash
./ops/backup.sh            # one archive $BACKUP_DIR/planar-<UTC>.tar
./ops/backup.sh --deep     # plus a check: each file name = sha256 of its content
./ops/backup.sh --rotate-only
```

The archive is a tar with `manifest.json`, `db.dump` (`pg_dump -Fc`) and `files.tar` (`files/<ab>/<cd>/<sha256>`). It is written as `.partial` and renamed after an integrity check (sha256 of the parts, `pg_restore -l`, `tar -t`, file count); on error the `.partial` is deleted and the exit code is non-zero. Rotation after a successful backup keeps the newest archive of each of the last 7 days (UTC) and of each of the last 4 ISO weeks; the fresh one is never deleted and foreign files in the directory are untouched.

Scheduling with cron:

```cron
0 3 * * * cd /opt/planar && ./ops/backup.sh >>backups/backup.log 2>&1
```

Or systemd, using the examples `ops/systemd/planar-backup.service` and `planar-backup.timer` (daily 03:00, `Persistent=true`; `WorkingDirectory=/opt/planar`, adjust the path):

```bash
sudo cp ops/systemd/planar-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now planar-backup.timer
```

Recommendation (the scripts do not do it): copy archives off the server, since a backup on the same disk does not protect against losing the disk. Store `.env` separately too.

## Restore

Restore goes onto a **clean stack** (brought up per [Installation](/install), with the same `.env`):

```bash
./ops/restore.sh backups/planar-20261025T030000Z.tar
```

The script starts postgres, checks the archive integrity and `format`/`version`, compares the migration count (an archive newer than the code is refused), checks that the database has no users, stops the api, recreates the `planar` database (`drop database … with (force)`, `create database`, `pg_restore`), replaces the files directory, starts the api and waits for `/api/health/ready` (up to 120 s). If the database already has users (`password_hash <> '!'`; the automation system user does not count), the script refuses; `--force` overwrites:

```bash
./ops/restore.sh --force backups/planar-20261025T030000Z.tar
```

The api applies any missing migrations on start. `ops/test-backup.sh` checks the full circle (stack → data → backup → drop volumes → restore → same tasks, files by sha256, login).

# Upgrade

```bash
./ops/upgrade.sh           # build from the current working copy
./ops/upgrade.sh --pull    # git pull --ff-only first
```

Steps:

1. Backup (`ops/backup.sh`); if it fails nothing is touched.
2. With `--pull`, `git pull --ff-only`.
3. Tags the current api and caddy images `:rollback`.
4. Builds the new images.
5. Applies migrations with the new image **before** switching; if they fail the old api keeps running.
6. Recreates api and caddy (`--force-recreate`).
7. Waits for `/api/health/ready` up to 120 s.
8. If not ready, restores the old images and recreates the containers; exit code 1. On success the `:rollback` tags are removed.

**Migration rule.** Migrations are not rolled back, so a single release may only contain expanding changes (new tables, columns, indexes; no drops or renames): the old image must work on the new schema. Destructive changes go in the next release. If after a failed upgrade you also need the data back, restore the archive made in step 1.

`ops/test-upgrade.sh` verifies a successful rollback and data preservation.
