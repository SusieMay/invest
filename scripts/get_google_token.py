"""
One-time script to get Google OAuth2 refresh token.
Run locally: python scripts/get_google_token.py

Steps before running:
1. Google Cloud Console → APIs & Services → Credentials
2. Create OAuth client ID → Desktop app
3. Copy Client ID and Client Secret
"""

from google_auth_oauthlib.flow import InstalledAppFlow

CLIENT_ID = input("Client ID: ").strip()
CLIENT_SECRET = input("Client Secret: ").strip()

flow = InstalledAppFlow.from_client_config(
    {
        "installed": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    },
    scopes=["https://www.googleapis.com/auth/drive.file"],
)

creds = flow.run_local_server(port=8090)

print("\n=== Save these as GitHub Secrets ===")
print(f"GOOGLE_CLIENT_ID = {CLIENT_ID}")
print(f"GOOGLE_CLIENT_SECRET = {CLIENT_SECRET}")
print(f"GOOGLE_REFRESH_TOKEN = {creds.refresh_token}")
