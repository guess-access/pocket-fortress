// Netlify deploy workaround for FAT volumes.
//
// Netlify's function tracer (@vercel/nft) calls fs.readlink() on every file it
// bundles. On FAT filesystems (e.g. the E: drive on this machine) Node returns
// EISDIR for ordinary files instead of EINVAL, and nft treats that as fatal,
// crashing the deploy. FAT cannot store symlinks, so a failed readlink there
// always means "not a link" - exactly what EINVAL signals. We therefore
// downgrade EISDIR to EINVAL. On any other filesystem the patch is inert.
//
// Loaded via NODE_OPTIONS=--require by deploy.cmd; never loaded at runtime.

'use strict';

const fs = require('fs');

function retagError(err) {
  if (err && err.code === 'EISDIR') {
    err.code = 'EINVAL';
  }
  return err;
}

// fs.promises.readlink(path[, options]) -> Promise
const origPromiseReadlink = fs.promises.readlink;
if (typeof origPromiseReadlink === 'function') {
  fs.promises.readlink = function readlink() {
    let result;
    try {
      result = origPromiseReadlink.apply(this, arguments);
    } catch (err) {
      throw retagError(err);
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => value,
        (err) => {
          throw retagError(err);
        }
      );
    }
    return result;
  };
}

// fs.readlink(path[, options], callback)
const origReadlink = fs.readlink;
if (typeof origReadlink === 'function') {
  fs.readlink = function readlink(path, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }
    if (typeof callback !== 'function') {
      return origReadlink.apply(this, arguments);
    }
    const wrapped = (err, link) => {
      if (err) retagError(err);
      callback(err, link);
    };
    return options === undefined
      ? origReadlink.call(this, path, wrapped)
      : origReadlink.call(this, path, options, wrapped);
  };
}

// fs.readlinkSync(path[, options]) -> string
const origReadlinkSync = fs.readlinkSync;
if (typeof origReadlinkSync === 'function') {
  fs.readlinkSync = function readlinkSync() {
    try {
      return origReadlinkSync.apply(this, arguments);
    } catch (err) {
      throw retagError(err);
    }
  };
}
