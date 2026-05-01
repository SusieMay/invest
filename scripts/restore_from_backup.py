"""
Restore Supabase tables from a gzip-compressed JSON backup created by
scripts/backup_to_drive.py.

Usage:
    python scripts/restore_from_backup.py path/to/supabase_backup_YYYY-MM-DD_HHMM.json.gz

Reads the backup, then upserts every row back into its table via the Supabase
REST API. Plain (uncompressed) .json files are also accepted.

Required environment variables:
  SUPABASE_URL          – Supabase project URL
  SUPABASE_SERVICE_KEY  – service_role key (not anon!)
"""

import gzip
import json
import os
import sys

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


def load_backup(path: str) -> dict:
    """Load a .json.gz (or plain .json) backup into a dict of {table: rows}."""
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def restore_table(table: str, rows: list) -> None:
    """Upsert all rows into a Supabase table in batches."""
    if not rows:
        print(f"  · {table}: brak wierszy, pomijam")
        return

    batch_size = 500
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS,
            data=json.dumps(batch),
            timeout=60,
        )
        resp.raise_for_status()
    print(f"  ✓ {table}: przywrócono {len(rows)} wierszy")


def main() -> None:
    if len(sys.argv) != 2:
        print("Użycie: python scripts/restore_from_backup.py <plik_backupu.json.gz>")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Nie znaleziono pliku: {path}")
        sys.exit(1)

    print(f"=== Przywracanie z {path} ===")
    backup = load_backup(path)

    for table, rows in backup.items():
        restore_table(table, rows)

    print("=== Gotowe ===")


if __name__ == "__main__":
    main()
