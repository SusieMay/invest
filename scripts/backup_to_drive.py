"""
Backup all Supabase tables to Google Drive as a single gzip-compressed JSON file.

Auth options:
- OAuth2 refresh token for personal Google Drive
- Service account for Google Workspace Shared Drives

Requires: google-auth, google-auth-oauthlib, google-api-python-client, requests

Restore: patrz scripts/restore_from_backup.py
"""

import gzip
import json
import os
import sys
import tempfile
from datetime import datetime

import requests
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GOOGLE_FOLDER_ID = os.environ["GOOGLE_DRIVE_FOLDER_ID"]
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_REFRESH_TOKEN = os.environ.get("GOOGLE_REFRESH_TOKEN")
GOOGLE_SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]

TABLES = [
    "assets",
    "portfolio_history",
    "dividends",
    "realized_trades",
    "transactions",
]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}


def fetch_table(table: str) -> list:
    """Fetch all rows from a Supabase table via REST API."""
    rows = []
    offset = 0
    limit = 1000
    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**HEADERS, "Prefer": "count=exact"},
            params={"select": "*", "offset": offset, "limit": limit},
            timeout=30,
        )
        if resp.status_code == 404:
            # Table doesn't exist, skip
            print(f"  ⚠ Table '{table}' not found, skipping")
            return []
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return rows


def get_drive_service():
    """Authenticate with Google Drive using service account or OAuth2 refresh token."""
    if GOOGLE_SERVICE_ACCOUNT_JSON:
        try:
            info = json.loads(GOOGLE_SERVICE_ACCOUNT_JSON)
            creds = ServiceAccountCredentials.from_service_account_info(
                info,
                scopes=DRIVE_SCOPES,
            )
        except (json.JSONDecodeError, ValueError) as exc:
            raise RuntimeError(
                "GOOGLE_SERVICE_ACCOUNT_JSON is not valid service account JSON."
            ) from exc
        return build("drive", "v3", credentials=creds)

    missing = [
        name
        for name, value in (
            ("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID),
            ("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET),
            ("GOOGLE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN),
        )
        if not value
    ]
    if missing:
        missing_names = ", ".join(missing)
        raise RuntimeError(
            "Missing Google Drive credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON "
            f"or the OAuth variables: {missing_names}."
        )

    # Do not force scopes here: the refresh token keeps the scope it was granted
    # (e.g. drive.file). Forcing a broader scope triggers "invalid_scope".
    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        token_uri="https://oauth2.googleapis.com/token",
    )
    try:
        creds.refresh(Request())
    except RefreshError as exc:
        raise RuntimeError(
            "Google OAuth refresh token is invalid, expired, or revoked. "
            "Prefer setting GOOGLE_SERVICE_ACCOUNT_JSON for unattended backups, "
            "or regenerate GOOGLE_REFRESH_TOKEN."
        ) from exc
    return build("drive", "v3", credentials=creds)


def upload_to_drive(service, filepath: str, filename: str):
    """Upload file to Google Drive folder."""
    file_metadata = {
        "name": filename,
        "parents": [GOOGLE_FOLDER_ID],
    }
    media = MediaFileUpload(filepath, mimetype="application/gzip")
    try:
        file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id,name",
            supportsAllDrives=True,
        ).execute()
    except HttpError as exc:
        details = str(exc)
        if "Service Accounts do not have storage quota" in details:
            raise RuntimeError(
                "Google service account cannot upload into a regular personal My Drive "
                "folder. Use a Shared Drive folder for GOOGLE_DRIVE_FOLDER_ID, or switch "
                "back to OAuth credentials for a personal Google account."
            ) from exc
        raise
    print(f"  ✓ Uploaded: {file['name']} (id: {file['id']})")
    return file


def cleanup_old_backups(service, keep: int = 30):
    """Keep only the last N backups in the folder."""
    results = service.files().list(
        q=f"'{GOOGLE_FOLDER_ID}' in parents and trashed=false",
        orderBy="createdTime desc",
        fields="files(id,name,createdTime)",
        pageSize=100,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    files = results.get("files", [])
    if len(files) > keep:
        for f in files[keep:]:
            service.files().delete(fileId=f["id"], supportsAllDrives=True).execute()
            print(f"  🗑 Deleted old backup: {f['name']}")


def main():
    print(f"=== Supabase → Google Drive backup ({datetime.now().isoformat()}) ===")

    # Fetch all tables
    backup_data = {}
    for table in TABLES:
        print(f"  Fetching {table}...")
        rows = fetch_table(table)
        backup_data[table] = rows
        print(f"    → {len(rows)} rows")

    # Write to temp file
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    filename = f"supabase_backup_{timestamp}.json.gz"
    tmpfile = os.path.join(tempfile.gettempdir(), filename)
    with gzip.open(tmpfile, "wt", encoding="utf-8") as f:
        json.dump(backup_data, f, ensure_ascii=False, default=str)

    size_mb = os.path.getsize(tmpfile) / (1024 * 1024)
    print(f"\n  Backup size: {size_mb:.2f} MB")

    # Upload to Google Drive
    print("\n  Uploading to Google Drive...")
    service = get_drive_service()
    upload_to_drive(service, tmpfile, filename)

    # Cleanup old backups (keep last 30)
    print("\n  Cleaning old backups...")
    cleanup_old_backups(service, keep=30)

    # Remove temp file
    os.remove(tmpfile)
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
