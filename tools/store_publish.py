"""Upload dist/model-librarian-<version>.zip to the Chrome Web Store and submit it for review.

Run by .github/workflows/store.yml when manifest.json's version changes on main. It uses the
Chrome Web Store API v2 as a service account, from these environment variables:

  CWS_SERVICE_ACCOUNT_KEY  the service account's JSON key (a repository secret)
  CWS_PUBLISHER_ID         Developer Dashboard → Publisher → Settings
  CWS_EXTENSION_ID         the item's ID (dnopofnpaeindcbbgfhfjkbnjmmjjkcc)

  pip install google-auth requests
  python tools/package.py && python tools/store_publish.py
"""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

from google.auth.transport.requests import Request
from google.oauth2 import service_account

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://chromewebstore.googleapis.com"


def token():
    info = json.loads(os.environ["CWS_SERVICE_ACCOUNT_KEY"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/chromewebstore"])
    creds.refresh(Request())
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::add-mask::{creds.token}")
    return creds.token


def call(method, url, auth, body=b"", kind="application/json"):
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {auth}", "Content-Type": kind})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url.split('/items/')[-1]}: HTTP {e.code}\n{e.read().decode(errors='replace')}")


def main():
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    package = ROOT / "dist" / f"model-librarian-{version}.zip"
    if not package.is_file():
        sys.exit(f"{package.relative_to(ROOT)} is missing: run python tools/package.py first")
    item = f"publishers/{os.environ['CWS_PUBLISHER_ID']}/items/{os.environ['CWS_EXTENSION_ID']}"
    auth = token()

    print(f"Uploading {package.name}")
    up = call("POST", f"{API}/upload/v2/{item}:upload", auth, package.read_bytes(), "application/zip")
    state = up.get("uploadState")
    for _ in range(30):
        if state != "IN_PROGRESS":
            break
        time.sleep(10)
        state = call("GET", f"{API}/v2/{item}:fetchStatus", auth, None).get("lastAsyncUploadState")
    if state != "SUCCEEDED":
        sys.exit(f"Upload didn't succeed ({state}): {json.dumps(up)}")
    print(f"Uploaded {up.get('crxVersion', version)}")

    pub = call("POST", f"{API}/v2/{item}:publish", auth, b"{}")
    state = pub.get("state")
    print(f"Submitted: {state}")
    if state not in ("PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"):
        sys.exit(json.dumps(pub))


if __name__ == "__main__":
    main()
