package com.example.riko

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.system.Os
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream

/**
 * Manages rootfs bootstrap: extraction, configuration, Node.js installation,
 * proot-compat.js injection, and fake /proc /sys file creation.
 */
class BootstrapManager(
    private val context: Context,
    private val filesDir: String,
    private val nativeLibDir: String
) {
    private val rootfsDir get() = "$filesDir/rootfs/ubuntu"
    private val tmpDir get() = "$filesDir/tmp"
    private val homeDir get() = "$filesDir/home"
    private val configDir get() = "$filesDir/config"
    private val libDir get() = "$filesDir/lib"

    // ---- Directory setup ----

    fun setupDirectories() {
        listOf(rootfsDir, tmpDir, homeDir, configDir, "$homeDir/.openclaw", libDir).forEach {
            File(it).mkdirs()
        }
        setupLibtalloc()
        setupFakeSysdata()
    }

    private fun setupLibtalloc() {
        val source = File("$nativeLibDir/libtalloc.so")
        val target = File("$libDir/libtalloc.so.2")
        if (source.exists() && !target.exists()) {
            source.copyTo(target)
            target.setExecutable(true)
        }
    }

    fun isBootstrapComplete(): Boolean {
        val rootfs = File(rootfsDir)
        val binBash = File("$rootfsDir/bin/bash")
        val bypass = File("$rootfsDir/root/.openclaw/bionic-bypass.js")
        val node = File("$rootfsDir/usr/local/bin/node")
        val backendMain = File("$rootfsDir/root/app/ts_backend/dist/main.js")
        val nodeModules = File("$rootfsDir/root/app/ts_backend/node_modules")
        return rootfs.exists() && binBash.exists() && bypass.exists()
            && node.exists() && backendMain.exists()
            && nodeModules.exists() && nodeModules.isDirectory
    }

    fun getBootstrapStatus(): Map<String, Any> {
        val rootfsExists = File(rootfsDir).exists()
        val binBashExists = File("$rootfsDir/bin/bash").exists()
        val nodeExists = File("$rootfsDir/usr/local/bin/node").exists()
        val backendExists = File("$rootfsDir/root/app/ts_backend/dist/main.js").exists()
        val bypassExists = File("$rootfsDir/root/.openclaw/bionic-bypass.js").exists()
        val nodeModulesExists = File("$rootfsDir/root/app/ts_backend/node_modules").exists()

        return mapOf(
            "rootfsExists" to rootfsExists,
            "binBashExists" to binBashExists,
            "nodeInstalled" to nodeExists,
            "backendInstalled" to backendExists,
            "bypassInstalled" to bypassExists,
            "nodeModulesInstalled" to nodeModulesExists,
            "rootfsPath" to rootfsDir,
            "complete" to (rootfsExists && binBashExists && bypassExists
                && nodeExists && backendExists && nodeModulesExists)
        )
    }

    private val extractionOrchestrator by lazy {
        RootfsExtractionOrchestrator(
            TarExtractor(),
            SymlinkHandler(),
            PermissionFixer(),
            ExtractionValidator(),
            filesDir
        )
    }

    // ---- Rootfs extraction (delegated to RootfsExtractionOrchestrator) ----

    fun extractRootfs(tarPath: String) {
        extractionOrchestrator.extractRootfs(tarPath, rootfsDir)
        configureRootfs()
    }

    // ---- Rootfs configuration ----

    private fun configureRootfs() {
        // 1. Disable apt sandboxing
        val aptConfDir = File("$rootfsDir/etc/apt/apt.conf.d")
        aptConfDir.mkdirs()
        File(aptConfDir, "01-riko-proot").writeText(
            "APT::Sandbox::User \"root\";\n" +
            "Dpkg::Use-Pty \"0\";\n" +
            "Dpkg::Options { \"--force-confnew\"; \"--force-overwrite\"; };\n"
        )

        // 2. Configure dpkg for proot
        val dpkgConfDir = File("$rootfsDir/etc/dpkg/dpkg.cfg.d")
        dpkgConfDir.mkdirs()
        File(dpkgConfDir, "01-riko-proot").writeText(
            "force-unsafe-io\nno-debsig\nforce-overwrite\nforce-depends\nforce-statoverride-add\n"
        )

        val statOverride = File("$rootfsDir/var/lib/dpkg/statoverride")
        if (statOverride.exists()) statOverride.writeText("")

        // 3. Pre-create essential directories
        listOf(
            "$rootfsDir/etc/ssl/certs",
            "$rootfsDir/usr/share/keyrings",
            "$rootfsDir/etc/apt/sources.list.d",
            "$rootfsDir/var/lib/dpkg/updates",
            "$rootfsDir/var/lib/dpkg/triggers",
            "$rootfsDir/tmp/npm-cache/_cacache/tmp",
            "$rootfsDir/tmp/npm-cache/_cacache/content-v2",
            "$rootfsDir/tmp/npm-cache/_cacache/index-v5",
            "$rootfsDir/tmp/npm-cache/_logs",
            "$rootfsDir/root/.npm",
            "$rootfsDir/root/.config",
            "$rootfsDir/usr/local/lib/node_modules",
            "$rootfsDir/usr/local/bin",
            "$rootfsDir/root/.openclaw",
            "$rootfsDir/root/.openclaw/data",
            "$rootfsDir/root/.openclaw/memory",
            "$rootfsDir/root/.openclaw/config",
            "$rootfsDir/root/.openclaw/logs",
            "$rootfsDir/root/.cache",
            "$rootfsDir/root/.cache/node",
            "$rootfsDir/root/app/ts_backend",
            "$rootfsDir/root/data",
            "$rootfsDir/var/tmp",
            "$rootfsDir/run",
            "$rootfsDir/run/lock",
            "$rootfsDir/dev/shm",
        ).forEach { File(it).mkdirs() }

        // 4. /etc/machine-id
        val machineId = File("$rootfsDir/etc/machine-id")
        if (!machineId.exists()) {
            machineId.parentFile?.mkdirs()
            machineId.writeText("10000000000000000000000000000000\n")
        }

        // 5. policy-rc.d
        val policyRc = File("$rootfsDir/usr/sbin/policy-rc.d")
        policyRc.parentFile?.mkdirs()
        policyRc.writeText("#!/bin/sh\nexit 101\n")
        policyRc.setExecutable(true, false)

        // 6. Register Android users
        registerAndroidUsers()

        // 7. /etc/hosts
        val hosts = File("$rootfsDir/etc/hosts")
        if (!hosts.exists() || !hosts.readText().contains("localhost")) {
            hosts.writeText(
                "127.0.0.1   localhost.localdomain localhost\n" +
                "::1         localhost.localdomain localhost ip6-localhost ip6-loopback\n"
            )
        }

        // 8. /tmp permissions
        val tmpDir = File("$rootfsDir/tmp")
        tmpDir.mkdirs()
        tmpDir.setReadable(true, false)
        tmpDir.setWritable(true, false)
        tmpDir.setExecutable(true, false)

        // 9. Fix executable permissions
        PermissionFixer().fixBinPermissions(rootfsDir)
    }

    private fun registerAndroidUsers() {
        val uid = android.os.Process.myUid()
        val gid = uid

        for (name in listOf("passwd", "shadow", "group", "gshadow")) {
            val f = File("$rootfsDir/etc/$name")
            if (f.exists()) f.setWritable(true, false)
        }

        val passwd = File("$rootfsDir/etc/passwd")
        if (passwd.exists() && !passwd.readText().contains("aid_android")) {
            passwd.appendText("aid_android:x:$uid:$gid:Android:/:/sbin/nologin\n")
        }

        val shadow = File("$rootfsDir/etc/shadow")
        if (shadow.exists() && !shadow.readText().contains("aid_android")) {
            shadow.appendText("aid_android:*:18446:0:99999:7:::\n")
        }

        val group = File("$rootfsDir/etc/group")
        if (group.exists()) {
            val content = group.readText()
            val groups = mapOf(
                "aid_inet" to 3003, "aid_net_raw" to 3004,
                "aid_sdcard_rw" to 1015, "aid_android" to gid,
            )
            for ((name, id) in groups) {
                if (!content.contains(name))
                    group.appendText("$name:x:$id:root,aid_android\n")
            }
        }

        val gshadow = File("$rootfsDir/etc/gshadow")
        if (gshadow.exists()) {
            val content = gshadow.readText()
            val groups = listOf("aid_inet", "aid_net_raw", "aid_sdcard_rw", "aid_android")
            for (name in groups) {
                if (!content.contains(name))
                    gshadow.appendText("$name:*::root,aid_android\n")
            }
        }
    }

    // ---- Node.js tarball extraction ----

    fun extractNodeTarball(tarPath: String) {
        val destDir = File("$rootfsDir/usr/local")
        destDir.mkdirs()

        var entryCount = 0
        try {
            FileInputStream(tarPath).use { fis ->
                BufferedInputStream(fis, 256 * 1024).use { bis ->
                    XZCompressorInputStream(bis).use { xzis ->
                        TarArchiveInputStream(xzis).use { tis ->
                            var entry: TarArchiveEntry? = tis.nextEntry
                            while (entry != null) {
                                entryCount++
                                val name = entry.name
                                val slashIdx = name.indexOf('/')
                                if (slashIdx < 0 || slashIdx == name.length - 1) {
                                    entry = tis.nextEntry
                                    continue
                                }
                                val relPath = name.substring(slashIdx + 1)
                                if (relPath.isEmpty()) {
                                    entry = tis.nextEntry
                                    continue
                                }

                                val outFile = File(destDir, relPath)
                                when {
                                    entry.isDirectory -> outFile.mkdirs()
                                    entry.isSymbolicLink -> {
                                        try {
                                            if (outFile.exists()) outFile.delete()
                                            outFile.parentFile?.mkdirs()
                                            Os.symlink(entry.linkName, outFile.absolutePath)
                                        } catch (_: Exception) {}
                                    }
                                    else -> {
                                        outFile.parentFile?.mkdirs()
                                        FileOutputStream(outFile).use { fos ->
                                            val buf = ByteArray(65536)
                                            var len: Int
                                            while (tis.read(buf).also { len = it } != -1) {
                                                fos.write(buf, 0, len)
                                            }
                                        }
                                        outFile.setReadable(true, false)
                                        outFile.setWritable(true, false)
                                        val mode = entry.mode
                                        if (mode and 0b001_001_001 != 0 ||
                                            relPath.startsWith("bin/") || relPath.contains(".so")) {
                                            outFile.setExecutable(true, false)
                                        }
                                    }
                                }
                                entry = tis.nextEntry
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            throw RuntimeException(
                "Node.js tarball 解压失败 ($entryCount 条目): ${e.message}"
            )
        }

        val nodeBin = File("$rootfsDir/usr/local/bin/node")
        if (!nodeBin.exists()) {
            throw RuntimeException(
                "Node.js 解压失败: /usr/local/bin/node 不存在 (处理了 $entryCount 条目)"
            )
        }
        nodeBin.setExecutable(true, false)
        File(tarPath).delete()
    }

    // ---- Copy ts_backend into rootfs ----

    fun copyBackend(backendAssetDir: String) {
        val destDir = File("$rootfsDir/root/app/ts_backend")
        destDir.mkdirs()
        copyDir(File(backendAssetDir), destDir)
    }

    private fun copyDir(src: File, dest: File) {
        dest.mkdirs()
        src.listFiles()?.forEach { file ->
            val target = File(dest, file.name)
            if (file.isDirectory) {
                copyDir(file, target)
            } else {
                file.copyTo(target, overwrite = true)
                if (file.canExecute()) target.setExecutable(true, false)
            }
        }
    }

    // ---- Bionic bypass / proot-compat.js injection ----

    fun installBionicBypass() {
        val bypassDir = File("$rootfsDir/root/.openclaw")
        if (!bypassDir.exists()) {
            bypassDir.mkdirs()
        }
        if (!bypassDir.exists()) {
            bypassDir.parentFile?.mkdirs()
            bypassDir.mkdir()
        }

        // 1. CWD fix
        val cwdFixContent = """
// RIKO CWD Fix - Auto-generated
const _origCwd = process.cwd;
process.cwd = function() {
  try { return _origCwd.call(process); }
  catch(e) { return process.env.HOME || '/root'; }
};
""".trimIndent()
        File(bypassDir, "cwd-fix.js").writeText(cwdFixContent)

        // 2. Node wrapper
        val wrapperContent = """
// RIKO Node Wrapper - Auto-generated
require('/root/.openclaw/proot-compat.js');
const script = process.argv[2];
if (script) {
  process.argv = [process.argv[0], script, ...process.argv.slice(3)];
  require(script);
}
""".trimIndent()
        File(bypassDir, "node-wrapper.js").writeText(wrapperContent)

        // 3. proot-compat.js — the comprehensive patch
        val prootCompatContent = """
// RIKO Proot Compatibility Layer - Auto-generated
// Patches broken syscalls in proot on Android 10+.

'use strict';

// 1. process.cwd() — getcwd() ENOSYS
const _origCwd = process.cwd;
process.cwd = function() {
  try { return _origCwd.call(process); }
  catch(e) { return process.env.HOME || '/root'; }
};

// 2. os module patches
const _os = require('os');

const _origHostname = _os.hostname;
_os.hostname = function() {
  try { return _origHostname.call(_os); }
  catch(e) { return 'localhost'; }
};

const _origTmpdir = _os.tmpdir;
_os.tmpdir = function() {
  try { const t = _origTmpdir.call(_os); return t || '/tmp'; }
  catch(e) { return '/tmp'; }
};

const _origHomedir = _os.homedir;
_os.homedir = function() {
  try { return _origHomedir.call(_os); }
  catch(e) { return process.env.HOME || '/root'; }
};

const _origUserInfo = _os.userInfo;
_os.userInfo = function(opts) {
  try { return _origUserInfo.call(_os, opts); }
  catch(e) {
    return { uid: 0, gid: 0, username: 'root',
      homedir: process.env.HOME || '/root', shell: '/bin/bash' };
  }
};

const _origCpus = _os.cpus;
_os.cpus = function() {
  try { const cpus = _origCpus.call(_os); if (cpus && cpus.length > 0) return cpus; }
  catch(e) {}
  return [{ model: 'ARM', speed: 2000, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }];
};

const _origTotalmem = _os.totalmem;
_os.totalmem = function() {
  try { return _origTotalmem.call(_os); }
  catch(e) { return 4 * 1024 * 1024 * 1024; }
};
const _origFreemem = _os.freemem;
_os.freemem = function() {
  try { return _origFreemem.call(_os); }
  catch(e) { return 2 * 1024 * 1024 * 1024; }
};

const _origNetIf = _os.networkInterfaces;
_os.networkInterfaces = function() {
  try {
    const ifaces = _origNetIf.call(_os);
    if (ifaces && Object.keys(ifaces).length > 0) return ifaces;
  } catch(e) {}
  return {
    lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4',
      mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }]
  };
};

// 3. fs.mkdir — mkdirat() ENOSYS
const _fs = require('fs');
const _path = require('path');
const _origMkdirSync = _fs.mkdirSync;
_fs.mkdirSync = function(p, options) {
  try { return _origMkdirSync.call(_fs, p, options); }
  catch(e) {
    if (e.code === 'ENOSYS' || (e.code === 'ENOENT' && options && options.recursive)) {
      const parts = _path.resolve(String(p)).split(_path.sep).filter(Boolean);
      let current = '';
      for (const part of parts) {
        current += _path.sep + part;
        try { _origMkdirSync.call(_fs, current); }
        catch(e2) { if (e2.code !== 'EEXIST' && e2.code !== 'EISDIR') {} }
      }
      return undefined;
    }
    throw e;
  }
};
const _origMkdir = _fs.mkdir;
_fs.mkdir = function(p, options, cb) {
  if (typeof options === 'function') { cb = options; options = undefined; }
  try { _fs.mkdirSync(p, options); if (cb) cb(null); }
  catch(e) { if (cb) cb(e); else throw e; }
};
const _fsp = _fs.promises;
if (_fsp) {
  const _origMkdirP = _fsp.mkdir;
  _fsp.mkdir = async function(p, options) {
    try { return await _origMkdirP.call(_fsp, p, options); }
    catch(e) {
      if (e.code === 'ENOSYS' || (e.code === 'ENOENT' && options && options.recursive)) {
        _fs.mkdirSync(p, options); return undefined;
      }
      throw e;
    }
  };
}

// 4. fs.rename — renameat2() ENOSYS fallback to copy+unlink
const _origRenameSync = _fs.renameSync;
_fs.renameSync = function(oldPath, newPath) {
  try { return _origRenameSync.call(_fs, oldPath, newPath); }
  catch(e) {
    if (e.code === 'ENOSYS' || e.code === 'EXDEV') {
      _fs.copyFileSync(oldPath, newPath);
      try { _fs.unlinkSync(oldPath); } catch(_) {}
      return;
    }
    throw e;
  }
};
const _origRename = _fs.rename;
_fs.rename = function(oldPath, newPath, cb) {
  _origRename.call(_fs, oldPath, newPath, function(err) {
    if (err && (err.code === 'ENOSYS' || err.code === 'EXDEV')) {
      try {
        _fs.copyFileSync(oldPath, newPath);
        try { _fs.unlinkSync(oldPath); } catch(_) {}
        if (cb) cb(null);
      } catch(e2) { if (cb) cb(e2); }
    } else { if (cb) cb(err); }
  });
};
if (_fsp) {
  const _origRenameP = _fsp.rename;
  _fsp.rename = async function(oldPath, newPath) {
    try { return await _origRenameP.call(_fsp, oldPath, newPath); }
    catch(e) {
      if (e.code === 'ENOSYS' || e.code === 'EXDEV') {
        await _fsp.copyFile(oldPath, newPath);
        try { await _fsp.unlink(oldPath); } catch(_) {}
        return;
      }
      throw e;
    }
  };
}

// 5. fs.chmod/chown — tolerate ENOSYS
for (const fn of ['chmod', 'chown', 'lchown']) {
  const origSync = _fs[fn + 'Sync'];
  if (origSync) {
    _fs[fn + 'Sync'] = function() {
      try { return origSync.apply(_fs, arguments); }
      catch(e) { if (e.code === 'ENOSYS') return; throw e; }
    };
  }
  const origAsync = _fs[fn];
  if (origAsync) {
    _fs[fn] = function() {
      const args = Array.from(arguments);
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      try { origSync.apply(_fs, args); if (cb) cb(null); }
      catch(e) {
        if (e.code === 'ENOSYS') { if (cb) cb(null); }
        else { if (cb) cb(e); else throw e; }
      }
    };
  }
}

// 6. fs.watch — inotify fallback
const _origWatch = _fs.watch;
_fs.watch = function(filename, options, listener) {
  try { return _origWatch.call(_fs, filename, options, listener); }
  catch(e) {
    if (e.code === 'ENOSYS' || e.code === 'ENOSPC' || e.code === 'ENOENT') {
      const EventEmitter = require('events');
      const fake = new EventEmitter();
      fake.close = function() {};
      fake.ref = function() { return this; };
      fake.unref = function() { return this; };
      return fake;
    }
    throw e;
  }
};

// 7. child_process.spawn — handle ENOSYS and ENOENT
const _cp = require('child_process');
const _EventEmitter = require('events');

function _isSideEffectCmd(cmd) {
  const base = String(cmd).split('/').pop();
  return base === 'git' || base === 'cmake';
}

function _shouldMock(errCode, cmd) {
  if (errCode === 'ENOSYS') return true;
  if (errCode === 'ENOENT' && _isSideEffectCmd(cmd)) return true;
  return false;
}

function _makeFakeChild(exitCode) {
  const fake = new _EventEmitter();
  fake.stdout = new (require('stream').Readable)({ read() { this.push(null); } });
  fake.stderr = new (require('stream').Readable)({ read() { this.push(null); } });
  fake.stdin = new (require('stream').Writable)({ write(c,e,cb) { cb(); } });
  fake.pid = 0; fake.exitCode = null;
  fake.kill = function() { return false; };
  fake.ref = function() { return this; };
  fake.unref = function() { return this; };
  fake.connected = false;
  fake.disconnect = function() {};
  process.nextTick(() => { fake.exitCode = exitCode; fake.emit('close', exitCode, null); });
  return fake;
}

function _makeFakeSyncResult(code) {
  return { status: code, signal: null, stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0), pid: 0,
    output: [null, Buffer.alloc(0), Buffer.alloc(0)], error: null };
}

const _origSpawn = _cp.spawn;
_cp.spawn = function(cmd, args, options) {
  try {
    const child = _origSpawn.call(_cp, cmd, args, options);
    child.on('error', (err) => {
      if (_shouldMock(err.code, cmd)) {
        const code = _isSideEffectCmd(cmd) ? 128 : 0;
        child.emit('close', code, null);
      }
    });
    return child;
  } catch(e) {
    if (_shouldMock(e.code, cmd)) return _makeFakeChild(_isSideEffectCmd(cmd) ? 128 : 0);
    throw e;
  }
};
const _origSpawnSync = _cp.spawnSync;
_cp.spawnSync = function(cmd, args, options) {
  try {
    const r = _origSpawnSync.call(_cp, cmd, args, options);
    if (r.error && _shouldMock(r.error.code, cmd))
      return _makeFakeSyncResult(_isSideEffectCmd(cmd) ? 128 : 0);
    return r;
  } catch(e) {
    if (_shouldMock(e.code, cmd)) return _makeFakeSyncResult(_isSideEffectCmd(cmd) ? 128 : 0);
    throw e;
  }
};
const _origExecFile = _cp.execFile;
_cp.execFile = function(file, args, options, cb) {
  if (typeof args === 'function') { cb = args; args = []; options = {}; }
  if (typeof options === 'function') { cb = options; options = {}; }
  try { return _origExecFile.call(_cp, file, args, options, cb); }
  catch(e) {
    if (_shouldMock(e.code, file)) {
      const code = _isSideEffectCmd(file) ? 128 : 0;
      if (cb) cb(code ? Object.assign(new Error('spawn failed'), {code:e.code}) : null, '', '');
      return;
    }
    throw e;
  }
};
const _origExecFileSync = _cp.execFileSync;
_cp.execFileSync = function(file, args, options) {
  try { return _origExecFileSync.call(_cp, file, args, options); }
  catch(e) {
    if (_shouldMock(e.code, file)) {
      if (_isSideEffectCmd(file)) throw e;
      return Buffer.alloc(0);
    }
    throw e;
  }
};
""".trimIndent()
        File(bypassDir, "proot-compat.js").writeText(prootCompatContent)

        // 4. Bionic bypass entry point
        val bypassContent = """
// RIKO Bionic Bypass - Auto-generated
require('/root/.openclaw/proot-compat.js');
""".trimIndent()
        File(bypassDir, "bionic-bypass.js").writeText(bypassContent)

        // 5. Git config — SSH → HTTPS rewrite
        val gitConfig = File("$rootfsDir/root/.gitconfig")
        gitConfig.writeText(
            "[url \"https://github.com/\"]\n" +
            "\tinsteadOf = ssh://git@github.com/\n" +
            "\tinsteadOf = git@github.com:\n" +
            "[advice]\n" +
            "\tdetachedHead = false\n"
        )

        // 6. Patch .bashrc
        val bashrc = File("$rootfsDir/root/.bashrc")
        val exportLine = "export NODE_OPTIONS=\"--require /root/.openclaw/bionic-bypass.js\""
        val existing = if (bashrc.exists()) bashrc.readText() else ""
        if (!existing.contains("bionic-bypass")) {
            bashrc.appendText("\n# RIKO Bionic Bypass\n$exportLine\n")
        }
    }

    // ---- DNS resolution ----

    private fun getSystemDnsServers(): String {
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm != null) {
                val network = cm.activeNetwork
                if (network != null) {
                    val linkProps: LinkProperties? = cm.getLinkProperties(network)
                    val dnsServers = linkProps?.dnsServers
                    if (dnsServers != null && dnsServers.isNotEmpty()) {
                        val lines = dnsServers.joinToString("\n") { "nameserver ${it.hostAddress}" }
                        return "$lines\nnameserver 8.8.8.8\n"
                    }
                }
            }
        } catch (_: Exception) {}
        return "nameserver 8.8.8.8\nnameserver 8.8.4.4\n"
    }

    fun writeResolvConf() {
        val content = getSystemDnsServers()
        try {
            val dir = File(context.filesDir, "config")
            dir.mkdirs()
            File(dir, "resolv.conf").writeText(content)
        } catch (_: Exception) {
            File(configDir).mkdirs()
            File(configDir, "resolv.conf").writeText(content)
        }
        try {
            val rootfsResolv = File(rootfsDir, "etc/resolv.conf")
            rootfsResolv.parentFile?.mkdirs()
            rootfsResolv.writeText(content)
        } catch (_: Exception) {}
    }

    // ---- Fake /proc and /sys files ----

    fun setupFakeSysdata() {
        val procDir = File("$configDir/proc_fakes")
        val sysDir = File("$configDir/sys_fakes")
        procDir.mkdirs()
        sysDir.mkdirs()

        File(procDir, "loadavg").writeText("0.12 0.07 0.02 2/165 765\n")
        File(procDir, "stat").writeText(
            "cpu  1957 0 2877 93280 262 342 254 87 0 0\n" +
            "cpu0 31 0 226 12027 82 10 4 9 0 0\n" +
            "cpu1 45 0 290 11498 21 9 8 7 0 0\n" +
            "cpu2 52 0 401 11730 36 15 6 10 0 0\n" +
            "cpu3 42 0 268 11677 31 12 5 8 0 0\n" +
            "cpu4 789 0 720 11364 26 100 83 18 0 0\n" +
            "cpu5 486 0 438 11685 42 86 60 13 0 0\n" +
            "cpu6 314 0 336 11808 45 68 52 11 0 0\n" +
            "cpu7 198 0 198 11491 25 42 36 11 0 0\n" +
            "intr 63361 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n" +
            "ctxt 38014093\nbtime 1694292441\nprocesses 26442\n" +
            "procs_running 1\nprocs_blocked 0\n" +
            "softirq 75663 0 5903 6 25375 10774 0 243 11685 0 21677\n"
        )
        File(procDir, "uptime").writeText("124.08 932.80\n")
        File(procDir, "version").writeText(
            "Linux version ${ProcessManager.FAKE_KERNEL_RELEASE} (proot@termux) " +
            "(gcc (GCC) 13.3.0, GNU ld (GNU Binutils) 2.42) " +
            "${ProcessManager.FAKE_KERNEL_VERSION}\n"
        )
        File(procDir, "vmstat").writeText(
            "nr_free_pages 1743136\nnr_zone_inactive_anon 179281\n" +
            "nr_zone_active_anon 7183\nnr_zone_inactive_file 22858\n" +
            "nr_zone_active_file 51328\nnr_zone_unevictable 642\n" +
            "nr_zone_write_pending 0\nnr_mlock 0\n" +
            "nr_slab_reclaimable 7520\nnr_slab_unreclaimable 10776\n" +
            "pgpgin 198292\npgpgout 7674\npswpin 0\npswpout 0\n" +
            "pgalloc_dma 0\npgalloc_dma32 0\npgalloc_normal 44669136\n" +
            "pgfree 46674674\npgactivate 1085674\npgdeactivate 340776\n" +
            "pglazyfree 139872\npgfault 37291463\npgmajfault 6854\n" +
            "pgrefill 480634\n"
        )
        File(procDir, "cap_last_cap").writeText("40\n")
        File(procDir, "max_user_watches").writeText("4096\n")
        File(procDir, "fips_enabled").writeText("0\n")
        File(sysDir, "empty").writeText("")
    }

    // ---- Utility ----

    private fun deleteRecursively(file: File) {
        try {
            if (!file.canonicalPath.startsWith(filesDir)) return
        } catch (_: Exception) {
            return
        }
        try {
            val path = file.toPath()
            if (java.nio.file.Files.isSymbolicLink(path)) {
                file.delete()
                return
            }
        } catch (_: Exception) {}
        if (file.isDirectory) {
            file.listFiles()?.forEach { deleteRecursively(it) }
        }
        file.delete()
    }
}
