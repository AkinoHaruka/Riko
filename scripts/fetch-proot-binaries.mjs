// Download pre-compiled PRoot binaries from Termux package repos.
// Pure Node.js implementation — no external dependencies.
//
// Usage: node scripts/fetch-proot-binaries.mjs

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JNILIBS_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'jniLibs');
const TMP_DIR = path.join(__dirname, '..', '.tmp-proot');
const TERMUX_REPO = 'https://packages.termux.dev/apt/termux-main';

// Convert Windows path to MSYS2-friendly format
function msysPath(p) {
  let result = p.replace(/\\/g, '/');
  result = result.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase());
  return result;
}

const ABIS = [
  { dir: 'arm64-v8a', arch: 'aarch64' },
  { dir: 'armeabi-v7a', arch: 'arm' },
  { dir: 'x86_64', arch: 'x86_64' },
];

function log(msg) { console.log(`[fetch-proot] ${msg}`); }

// ---- HTTP helpers ----

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        httpsGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ---- Parse Termux Packages index ----

function findPackageUrl(packagesText, pkgName) {
  const lines = packagesText.split('\n');
  let inPkg = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === `Package: ${pkgName}`) {
      inPkg = true;
    } else if (inPkg && lines[i].startsWith('Package: ')) {
      break;
    }
    if (inPkg && lines[i].startsWith('Filename: ')) {
      return lines[i].slice('Filename: '.length).trim();
    }
  }
  return null;
}

// ---- AR archive parser (extracts data.tar.* from .deb) ----

function extractDataTarFromDeb(debBuffer, outDir) {
  const header = debBuffer.toString('ascii', 0, 8);
  if (header !== '!<arch>\n') {
    throw new Error('Not a valid ar archive');
  }

  let offset = 8;
  while (offset < debBuffer.length) {
    if (offset + 60 > debBuffer.length) break;
    const entryHeader = debBuffer.toString('ascii', offset, offset + 60);
    const name = entryHeader.slice(0, 16).trim();
    const sizeStr = entryHeader.slice(48, 58).trim();
    const size = parseInt(sizeStr, 10) || 0;
    offset += 60;

    if (name.startsWith('data.tar')) {
      const data = debBuffer.slice(offset, offset + size);
      const outPath = path.join(outDir, name);
      fs.writeFileSync(outPath, data);
      log(`    Extracted ${name} (${size} bytes)`);
      return outPath;
    }

    offset += size;
    if (offset % 2 !== 0) offset++;
  }

  throw new Error('data.tar.* not found in .deb');
}

// ---- Pure JS tar extractor (simplified, handles what we need) ----

function extractTar(archivePath, outDir, patterns) {
  fs.mkdirSync(outDir, { recursive: true });

  // If .xz or .zst, use MSYS2 tar with Unix paths
  const ext = path.extname(archivePath);
  if (ext === '.xz' || ext === '.zst' || ext === '.gz') {
    const unixArchive = msysPath(archivePath);
    const unixOut = msysPath(outDir);
    const glob = patterns.map(p => `'${p}'`).join(' ');
    try {
      execSync(`tar -xf "${unixArchive}" -C "${unixOut}" ${glob}`, {
        stdio: 'pipe', timeout: 30000,
        env: { PATH: process.env.PATH },
      });
    } catch (e) {
      // Try without glob (tar might not support it)
      try {
        execSync(`tar -xf "${unixArchive}" -C "${unixOut}"`, {
          stdio: 'pipe', timeout: 30000,
          env: { PATH: process.env.PATH },
        });
      } catch (e2) {
        log(`    tar extraction warning: ${e2.message}`);
      }
    }
    return;
  }

  // Plain .tar — pure JS extraction
  const buf = fs.readFileSync(archivePath);
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const block = buf.slice(offset, offset + 512);
    // Check for end-of-archive (two consecutive zero blocks)
    if (block.every(b => b === 0)) break;

    const nameField = block.toString('ascii', 0, 100).replace(/\0/g, '').trim();
    const sizeField = block.slice(124, 136).toString('ascii').replace(/\0/g, '').trim();
    const typeField = block.toString('ascii', 156, 157);

    if (!nameField) { offset += 512; continue; }

    const size = parseInt(sizeField, 8) || 0;
    const blocks = Math.ceil(size / 512);

    if (typeField === '0' || typeField === '\x00') {
      // Regular file
      const data = buf.slice(offset + 512, offset + 512 + size);
      const outPath = path.join(outDir, nameField);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, data);
      // Set executable if it looks like a binary
      if (nameField.includes('/bin/') || nameField.endsWith('.so') || nameField.includes('.so.')) {
        fs.chmodSync(outPath, 0o755);
      }
    } else if (typeField === '5') {
      // Directory
      fs.mkdirSync(path.join(outDir, nameField), { recursive: true });
    }

    offset += 512 + blocks * 512;
    if (offset % 512 !== 0) offset += 512 - (offset % 512);
  }
}

// ---- Find files in extracted directory ----

function findAndCopy(searchDir, pattern, destPath) {
  function walk(dir) {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (e.isFile() && e.name === pattern) {
        return full;
      }
    }
    return null;
  }

  const found = walk(searchDir);
  if (found) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(found, destPath);
    fs.chmodSync(destPath, 0o755);
    return true;
  }
  return false;
}

function findAnyLib(searchDir, prefix) {
  function walk(dir) {
    if (!fs.existsSync(dir)) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return null; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (e.isFile() && e.name.startsWith(prefix)) {
        return full;
      }
    }
    return null;
  }
  return walk(searchDir);
}

// ---- Main fetch logic for one ABI ----

async function fetchForAbi(abiDir, debArch) {
  const outDir = path.join(JNILIBS_DIR, abiDir);
  fs.mkdirSync(outDir, { recursive: true });

  const indexUrl = `${TERMUX_REPO}/dists/stable/main/binary-${debArch}/Packages`;
  log(`  Fetching package index: ${indexUrl}`);
  const indexText = (await httpsGet(indexUrl)).toString();

  const prootUrl = findPackageUrl(indexText, 'proot');
  if (!prootUrl) { log(`  WARN: proot not found for ${debArch}`); return false; }
  const tallocUrl = findPackageUrl(indexText, 'libtalloc');
  if (!tallocUrl) { log(`  WARN: libtalloc not found for ${debArch}`); return false; }

  const tmp = path.join(TMP_DIR, abiDir);
  fs.mkdirSync(tmp, { recursive: true });

  // Download and extract proot
  log(`  Downloading proot...`);
  const prootDeb = await httpsGet(`${TERMUX_REPO}/${prootUrl}`);
  fs.writeFileSync(path.join(tmp, 'proot.deb'), prootDeb);
  const prootTar = extractDataTarFromDeb(prootDeb, tmp);
  const prootExtract = path.join(tmp, 'proot_extracted');
  extractTar(prootTar, prootExtract, ['./*/bin/proot', './*/proot/loader', './*/proot/loader32']);

  // Find and copy proot binary
  // Termux proot deb has: data/data/com.termux/files/usr/bin/proot
  const prootBin = findAnyLib(prootExtract, 'proot');
  if (prootBin && path.basename(prootBin) === 'proot') {
    fs.copyFileSync(prootBin, path.join(outDir, 'libproot.so'));
    fs.chmodSync(path.join(outDir, 'libproot.so'), 0o755);
    log('  ✓ libproot.so');
  } else {
    log(`  ERROR: proot binary not found. Found: ${prootBin}`);
    return false;
  }

  // Find and copy loaders
  const loader = findAnyLib(prootExtract, 'loader');
  if (loader && !loader.includes('loader32')) {
    fs.copyFileSync(loader, path.join(outDir, 'libprootloader.so'));
    fs.chmodSync(path.join(outDir, 'libprootloader.so'), 0o755);
    log('  ✓ libprootloader.so');
  }

  const loader32 = findAnyLib(prootExtract, 'loader32');
  if (loader32) {
    fs.copyFileSync(loader32, path.join(outDir, 'libprootloader32.so'));
    fs.chmodSync(path.join(outDir, 'libprootloader32.so'), 0o755);
    log('  ✓ libprootloader32.so');
  }

  // Download and extract libtalloc
  log(`  Downloading libtalloc...`);
  const tallocDeb = await httpsGet(`${TERMUX_REPO}/${tallocUrl}`);
  fs.writeFileSync(path.join(tmp, 'libtalloc.deb'), tallocDeb);
  const tallocTar = extractDataTarFromDeb(tallocDeb, tmp);
  const tallocExtract = path.join(tmp, 'talloc_extracted');
  extractTar(tallocTar, tallocExtract, ['./*/lib/libtalloc.so.*']);

  const tallocLib = findAnyLib(tallocExtract, 'libtalloc.so');
  if (tallocLib) {
    fs.copyFileSync(tallocLib, path.join(outDir, 'libtalloc.so'));
    fs.chmodSync(path.join(outDir, 'libtalloc.so'), 0o755);
    log('  ✓ libtalloc.so');
  } else {
    log('  WARN: libtalloc.so not found');
  }

  log(`  [${abiDir}] OK`);
  return true;
}

// ---- Entry ----

async function main() {
  log('=== Fetching PRoot + libtalloc from Termux packages ===\n');

  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });

  let success = 0;
  let failed = 0;

  for (const { dir, arch } of ABIS) {
    try {
      log(`[${dir}] Processing...`);
      if (await fetchForAbi(dir, arch)) success++;
      else failed++;
    } catch (e) {
      log(`  [${dir}] ERROR: ${e.message}`);
      failed++;
    }
    console.log('');
  }

  log(`=== Summary: ${success}/${ABIS.length} success, ${failed} failed ===`);
  for (const { dir } of ABIS) {
    const d = path.join(JNILIBS_DIR, dir);
    if (fs.existsSync(d)) {
      const files = fs.readdirSync(d).filter(f => f.startsWith('lib'));
      log(`  ${dir}: ${files.join(', ') || '(empty)'}`);
    }
  }

  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) {}
  log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
