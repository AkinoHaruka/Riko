#!/usr/bin/env python3
"""Prepare Android assets for the proot + Ubuntu rootfs APK.

Downloads:
  1. Ubuntu 24.04 base rootfs (ARM64) → assets/rootfs/ubuntu-base-arm64.tar.gz
  2. Node.js ARM64 binary tarball → assets/rootfs/node-v22.14.0-linux-arm64.tar.xz

Then compiles the TypeScript backend and copies it to assets/backend/.

Usage: python scripts/prepare-android-assets.py
"""

import os
import sys
import shutil
import subprocess
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ASSETS_DIR = PROJECT_DIR / "android" / "app" / "src" / "main" / "assets"
ROOTFS_ASSETS = ASSETS_DIR / "rootfs"
BACKEND_ASSETS = ASSETS_DIR / "backend"
TS_BACKEND_DIR = PROJECT_DIR / "ts_backend"

UBUNTU_BASE_URL = "https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-arm64.tar.gz"
NODE_URL = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-arm64.tar.xz"


def log(msg):
    print(f"[prepare-assets] {msg}")


def download(url, dest):
    """Download a file with progress indicator."""
    dest = Path(dest)
    if dest.exists():
        log(f"  {dest.name} already exists ({dest.stat().st_size} bytes), skipping")
        return

    log(f"  Downloading {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "riko-build/1.0"})

    with urllib.request.urlopen(req, timeout=300) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0

        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    mb = downloaded / (1024 * 1024)
                    total_mb = total / (1024 * 1024)
                    print(f"\r    {pct}% ({mb:.1f}/{total_mb:.1f} MB)", end="", flush=True)

        print()
        log(f"  {dest.name} downloaded ({downloaded} bytes)")


def compile_backend():
    """Compile TypeScript backend and copy to assets."""
    log("Compiling TypeScript backend...")
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    result = subprocess.run(
        [npx_cmd, "tsc"],
        cwd=str(TS_BACKEND_DIR),
        capture_output=True,
        text=True,
        shell=True,
        timeout=120,
    )
    if result.returncode != 0:
        log(f"  tsc failed:\n{result.stderr}")
        return False

    dist_dir = TS_BACKEND_DIR / "dist"
    if not dist_dir.exists():
        log("  dist/ not found after tsc!")
        return False

    # Clean and copy
    if BACKEND_ASSETS.exists():
        shutil.rmtree(BACKEND_ASSETS)
    BACKEND_ASSETS.mkdir(parents=True, exist_ok=True)

    shutil.copytree(dist_dir, BACKEND_ASSETS / "dist", dirs_exist_ok=True)

    # Package pre-built node_modules as tarball (no npm install on device)
    node_modules_dir = TS_BACKEND_DIR / "node_modules"
    if node_modules_dir.exists():
        import tarfile
        tarball_path = BACKEND_ASSETS / "node_modules.tar.gz"
        log("  Creating node_modules.tar.gz...")
        with tarfile.open(tarball_path, "w:gz") as tar:
            tar.add(node_modules_dir, arcname="node_modules")
        size_mb = tarball_path.stat().st_size / (1024 * 1024)
        log(f"  node_modules.tar.gz created ({size_mb:.1f} MB)")

    # Copy prompts if they exist
    prompts_dir = TS_BACKEND_DIR / "data" / "prompts"
    if prompts_dir.exists():
        prompts_dest = BACKEND_ASSETS / "data" / "prompts"
        prompts_dest.mkdir(parents=True, exist_ok=True)
        for f in prompts_dir.iterdir():
            if f.is_file():
                shutil.copy2(f, prompts_dest / f.name)

    log(f"  Backend copied to {BACKEND_ASSETS}")
    return True


def main():
    log("=== Preparing Android assets ===\n")

    ROOTFS_ASSETS.mkdir(parents=True, exist_ok=True)

    # 1. Download Ubuntu base rootfs
    log("[1/3] Ubuntu base rootfs")
    download(UBUNTU_BASE_URL, ROOTFS_ASSETS / "ubuntu-base-arm64.tar.gz")

    # 2. Download Node.js ARM64 tarball
    log("\n[2/3] Node.js ARM64 binary")
    download(NODE_URL, ROOTFS_ASSETS / "node-v22.14.0-linux-arm64.tar.xz")

    # 3. Compile and copy backend
    log("\n[3/3] Backend")
    compile_backend()

    log("\n=== Assets prepared ===")
    log(f"Rootfs: {ROOTFS_ASSETS}")
    log(f"Backend: {BACKEND_ASSETS}")

    # Print sizes
    for f in ROOTFS_ASSETS.iterdir():
        size_mb = f.stat().st_size / (1024 * 1024)
        log(f"  {f.name}: {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
