// Full bootstrap for Android nodejs-mobile
var fs = require('fs');
var path = require('path');
var dir = globalThis.BOOT_DIR || __dirname;

var trace = function(msg) {
  try { fs.writeFileSync('/data/user/0/com.example.riko/files/data/boot_ok.txt', msg); } catch(e) {}
};

// Load env
var envPath = path.join(dir, 'env.json');
if (fs.existsSync(envPath)) {
  var config = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
  Object.keys(config).forEach(function(k) { process.env[k] = config[k]; });
  trace('env_OK_PORT=' + process.env.PORT);
}

// Load the esbuild bundle (single CJS file, self-contained)
var bundlePath = path.join(dir, 'bundle.cjs');
if (fs.existsSync(bundlePath)) {
  trace('loading_bundle_' + fs.statSync(bundlePath).size + 'bytes');
  try {
    eval(fs.readFileSync(bundlePath, 'utf8'));
    trace('bundle_loaded');
  } catch(e) {
    trace('bundle_ERROR:' + e.message);
  }
} else {
  trace('bundle_NOT_FOUND');
}
