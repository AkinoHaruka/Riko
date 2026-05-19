#!/usr/bin/env python3
"""Download pre-compiled PRoot binaries from Termux package repos.
Extracts libproot.so, libprootloader.so, libtalloc.so from .deb files.
Places them in jniLibs/<abi>/ for Android packaging.

Usage: python scripts/fetch-proot-binaries.py
"""

import os
import re
import sys
import gzip
import lzma
import tarfile
import shutil
import tempfile
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
JNILIBS_DIR = PROJECT_DIR / "android" / "app" / "src" / "main" / "jniLibs"
TERMUX_REPO = "https://packages.termux.dev/apt/termux-main"

ABIS = [
    ("arm64-v8a", "aarch64"),
    ("armeabi-v7a", "arm"),
    ("x86_64", "x86_64"),
]


def log(msg):
    print(f"[fetch-proot] {msg}")


# ---- HTTP ----


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fetch-proot/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


# ---- Parse Termux Packages index ----


def find_package_url(packages_text, pkg_name):
    lines = packages_text.split("\n")
    in_pkg = False
    for line in lines:
        if line == f"Package: {pkg_name}":
            in_pkg = True
        elif in_pkg and line.startswith("Package: "):
            break  # next package
        if in_pkg and line.startswith("Filename: "):
            return line.split(": ", 1)[1].strip()
    return None


# ---- AR archive extraction ----


def extract_data_tar_from_deb(deb_data, out_dir):
    """Parse ar archive (.deb) and extract data.tar.* to out_dir."""
    if deb_data[:8] != b"!<arch>\n":
        raise ValueError("Not a valid ar archive")

    pos = 8
    while pos < len(deb_data):
        if pos + 60 > len(deb_data):
            break
        header = deb_data[pos : pos + 60].decode("ascii", errors="replace")
        name = header[:16].strip()
        size_str = header[48:58].strip()
        size = int(size_str) if size_str else 0
        pos += 60

        if name.startswith("data.tar"):
            data = deb_data[pos : pos + size]
            out_path = out_dir / name
            out_path.write_bytes(data)
            log(f"    Extracted {name} ({size} bytes)")
            return out_path

        pos += size
        if pos % 2:
            pos += 1

    raise ValueError("data.tar.* not found in .deb")


# ---- Find and copy files ----


def find_and_copy(search_dir, filename, dest_path, is_exe=False):
    """Search recursively for a file and copy it."""
    for root, dirs, files in os.walk(search_dir):
        for f in files:
            if f == filename:
                src = Path(root) / f
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest_path)
                if is_exe:
                    dest_path.chmod(0o755)
                return True
    return False


def find_any(search_dir, prefix):
    """Search recursively for any file starting with prefix."""
    for root, dirs, files in os.walk(search_dir):
        for f in files:
            if f.startswith(prefix):
                return Path(root) / f
    return None


# ---- Main fetch for one ABI ----


def fetch_for_abi(abi_dir, deb_arch):
    out_dir = JNILIBS_DIR / abi_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fetch Packages index
    index_url = f"{TERMUX_REPO}/dists/stable/main/binary-{deb_arch}/Packages"
    log(f"  Fetching package index: {index_url}")
    index_text = http_get(index_url).decode()

    # 2. Find package URLs
    proot_url_part = find_package_url(index_text, "proot")
    talloc_url_part = find_package_url(index_text, "libtalloc")
    if not proot_url_part:
        log(f"  WARN: proot not found for {deb_arch}")
        return False
    if not talloc_url_part:
        log(f"  WARN: libtalloc not found for {deb_arch}")
        return False

    with tempfile.TemporaryDirectory() as tmp_base:
        tmp = Path(tmp_base) / abi_dir
        tmp.mkdir(parents=True, exist_ok=True)

        # 3. Download proot .deb
        log("  Downloading proot...")
        proot_deb = http_get(f"{TERMUX_REPO}/{proot_url_part}")
        (tmp / "proot.deb").write_bytes(proot_deb)

        # 4. Extract data.tar.* from .deb
        data_tar = extract_data_tar_from_deb(proot_deb, tmp)
        extract_dir = tmp / "proot_extracted"
        extract_dir.mkdir(exist_ok=True)

        # 5. Extract tar (xz or gz)
        log(f"  Extracting {data_tar.name}...")
        tar_name = str(data_tar)
        if tar_name.endswith(".xz"):
            with lzma.open(tar_name, "rb") as xz_f:
                with tarfile.open(fileobj=xz_f) as tf:
                    tf.extractall(path=str(extract_dir))
        elif tar_name.endswith(".gz"):
            with gzip.open(tar_name, "rb") as gz_f:
                with tarfile.open(fileobj=gz_f) as tf:
                    tf.extractall(path=str(extract_dir))
        else:
            with tarfile.open(tar_name, "r") as tf:
                tf.extractall(path=str(extract_dir))

        # 6. Find and copy proot binary
        proot_bin = find_any(extract_dir, "proot")
        if proot_bin and proot_bin.name == "proot":
            dest = out_dir / "libproot.so"
            shutil.copy2(proot_bin, dest)
            dest.chmod(0o755)
            log("  [OK] libproot.so")
        else:
            log(f"  ERROR: proot binary not found. Candidate: {proot_bin}")
            return False

        # 7. Find and copy loaders
        loader = find_any(extract_dir, "loader")
        loader32 = find_any(extract_dir, "loader32")
        if loader and "loader32" not in str(loader):
            ldest = out_dir / "libprootloader.so"
            shutil.copy2(loader, ldest)
            ldest.chmod(0o755)
            log("  [OK] libprootloader.so")
        if loader32:
            ldest = out_dir / "libprootloader32.so"
            shutil.copy2(loader32, ldest)
            ldest.chmod(0o755)
            log("  [OK] libprootloader32.so")

        # 8. Download and extract libtalloc
        log("  Downloading libtalloc...")
        talloc_deb = http_get(f"{TERMUX_REPO}/{talloc_url_part}")
        (tmp / "libtalloc.deb").write_bytes(talloc_deb)

        data_tar2 = extract_data_tar_from_deb(talloc_deb, tmp)
        talloc_extract = tmp / "talloc_extracted"
        talloc_extract.mkdir(exist_ok=True)

        log(f"  Extracting {data_tar2.name}...")
        tar_name2 = str(data_tar2)
        if tar_name2.endswith(".xz"):
            with lzma.open(tar_name2, "rb") as xz_f:
                with tarfile.open(fileobj=xz_f) as tf:
                    tf.extractall(path=str(talloc_extract))
        elif tar_name2.endswith(".gz"):
            with gzip.open(tar_name2, "rb") as gz_f:
                with tarfile.open(fileobj=gz_f) as tf:
                    tf.extractall(path=str(talloc_extract))
        else:
            with tarfile.open(tar_name2, "r") as tf:
                tf.extractall(path=str(talloc_extract))

        # 9. Find libtalloc
        talloc_lib = find_any(talloc_extract, "libtalloc.so")
        if talloc_lib:
            dest = out_dir / "libtalloc.so"
            shutil.copy2(talloc_lib, dest)
            dest.chmod(0o755)
            log("  [OK] libtalloc.so")
        else:
            log("  WARN: libtalloc.so not found")

        log(f"  [{abi_dir}] OK")
        return True


# ---- Entry ----

def main():
    log("=== Fetching PRoot + libtalloc from Termux packages ===\n")

    success = 0
    failed = 0

    for abi_dir, deb_arch in ABIS:
        try:
            log(f"[{abi_dir}] Processing...")
            if fetch_for_abi(abi_dir, deb_arch):
                success += 1
            else:
                failed += 1
        except Exception as e:
            log(f"  [{abi_dir}] ERROR: {e}")
            failed += 1
        print()

    log(f"=== Summary: {success}/{len(ABIS)} success, {failed} failed ===")
    for abi_dir, _ in ABIS:
        d = JNILIBS_DIR / abi_dir
        if d.exists():
            files = [f.name for f in d.iterdir() if f.name.startswith("lib")]
            log(f"  {abi_dir}: {', '.join(files) or '(empty)'}")

    log("\nDone.")


if __name__ == "__main__":
    main()
