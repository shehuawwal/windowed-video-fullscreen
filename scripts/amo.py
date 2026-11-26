#!/usr/bin/env python3
"""Small client for the addons.mozilla.org (AMO) v5 API. Standard library only.

Needs AMO_JWT_ISSUER and AMO_JWT_SECRET in the environment
(https://addons.mozilla.org/developers/addon/api/key/).

  scripts/amo.py status                 # listing status, versions, previews
  scripts/amo.py download 2.1.0 dist    # signed .xpi, once AMO has approved that version
  scripts/amo.py edit amo/metadata.json # update listing text, categories, links
  scripts/amo.py previews [--resume] amo/screenshots/*.png  # replace (or finish uploading) screenshots
"""
import base64, hashlib, hmac, json, mimetypes, os, sys, time, urllib.error, urllib.request, uuid

API = "https://addons.mozilla.org/api/v5"
ADDON_ID = "windowed-video-fullscreen@shehuawwal.github.io"


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def token():
    iss = os.environ["AMO_JWT_ISSUER"]
    secret = os.environ["AMO_JWT_SECRET"].encode()
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"iss": iss, "jti": str(uuid.uuid4()), "iat": now, "exp": now + 240}).encode())
    sig = b64(hmac.new(secret, header + b"." + payload, hashlib.sha256).digest())
    return (header + b"." + payload + b"." + sig).decode()


def call(method, path, body=None, files=None):
    url = path if path.startswith("http") else API + path
    headers = {"Authorization": "JWT " + token()}
    data = None
    if files is not None:
        boundary = uuid.uuid4().hex
        parts = []
        for field, (name, content) in files.items():
            ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n".encode() + content + b"\r\n"
            )
        for field, value in (body or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    for attempt in range(6):
        headers["Authorization"] = "JWT " + token()  # fresh token per attempt (they expire quickly)
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:  # throttled: wait as told, then retry
                wait = int(e.headers.get("Retry-After") or 60) + 2
                print(f"throttled, waiting {wait}s", flush=True)
                time.sleep(wait)
                continue
            sys.exit(f"{method} {url} -> HTTP {e.code}: {e.read().decode(errors='replace')[:2000]}")


def addon_path():
    return "/addons/addon/" + urllib.request.quote(ADDON_ID, safe="") + "/"


def status():
    a = call("GET", addon_path())
    print("slug:", a.get("slug"), "| status:", a.get("status"), "| url:", a.get("url"))
    print("categories:", a.get("categories"))
    print("summary:", (a.get("summary") or {}).get("en-US"))
    print("previews:", len(a.get("previews") or []))
    vs = call("GET", addon_path() + "versions/?filter=all_with_unlisted")
    for v in vs.get("results", []):
        print("version", v["version"], "| channel:", v.get("channel"), "| file status:", (v.get("file") or {}).get("status"))


def edit(path):
    meta = json.load(open(path))
    meta.pop("version", None)  # version-level fields go with an upload, not here
    a = call("PATCH", addon_path(), meta)
    print("updated:", a.get("slug"), a.get("categories"))


def previews(paths, keep_existing=False):
    a = call("GET", addon_path())
    existing = a.get("previews") or []
    start = 0
    if keep_existing:
        start = len(existing)
        paths = paths[start:]
    else:
        for p in existing:
            call("DELETE", addon_path() + f"previews/{p['id']}/")
    for i, path in enumerate(paths, start):
        with open(path, "rb") as f:
            call("POST", addon_path() + "previews/", body={"position": i}, files={"image": (os.path.basename(path), f.read())})
        print("uploaded", path)


def download(version, out_dir):
    """Download the signed .xpi for `version` if AMO has approved it.
    Exit code 0 = downloaded, 3 = not signed/approved yet."""
    vs = call("GET", addon_path() + "versions/?filter=all_with_unlisted&page_size=50")
    for v in vs.get("results", []):
        if v["version"] != version:
            continue
        f = v.get("file") or {}
        if f.get("status") != "public" or not f.get("url"):
            print(f"{version}: not approved yet (file status: {f.get('status')})")
            sys.exit(3)
        req = urllib.request.Request(f["url"], headers={"Authorization": "JWT " + token()})
        dest = os.path.join(out_dir, f"windowed-video-fullscreen-{version}-firefox-signed.xpi")
        with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as fh:
            fh.write(r.read())
        print(f"{version}: downloaded {dest} ({v.get('channel')})")
        return
    print(f"{version}: not on AMO")
    sys.exit(3)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        status()
    elif cmd == "edit":
        edit(sys.argv[2])
    elif cmd == "previews":  # --resume: keep already-uploaded ones, upload the rest
        args = sys.argv[2:]
        resume = "--resume" in args
        previews([a for a in args if a != "--resume"], keep_existing=resume)
    elif cmd == "download":  # download VERSION [DIR]
        download(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ".")
    else:
        sys.exit(__doc__)
