import { createRequire as __panelCreateRequire } from "node:module"; const require = __panelCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/pend/index.js
var require_pend = __commonJS({
  "../../node_modules/pend/index.js"(exports, module) {
    module.exports = Pend;
    function Pend() {
      this.pending = 0;
      this.max = Infinity;
      this.listeners = [];
      this.waiting = [];
      this.error = null;
    }
    Pend.prototype.go = function(fn) {
      if (this.pending < this.max) {
        pendGo(this, fn);
      } else {
        this.waiting.push(fn);
      }
    };
    Pend.prototype.wait = function(cb) {
      if (this.pending === 0) {
        cb(this.error);
      } else {
        this.listeners.push(cb);
      }
    };
    Pend.prototype.hold = function() {
      return pendHold(this);
    };
    function pendHold(self) {
      self.pending += 1;
      var called = false;
      return onCb;
      function onCb(err) {
        if (called) throw new Error("callback called twice");
        called = true;
        self.error = self.error || err;
        self.pending -= 1;
        if (self.waiting.length > 0 && self.pending < self.max) {
          pendGo(self, self.waiting.shift());
        } else if (self.pending === 0) {
          var listeners = self.listeners;
          self.listeners = [];
          listeners.forEach(cbListener);
        }
      }
      function cbListener(listener) {
        listener(self.error);
      }
    }
    function pendGo(self, fn) {
      fn(pendHold(self));
    }
  }
});

// ../../node_modules/yauzl/fd-slicer.js
var require_fd_slicer = __commonJS({
  "../../node_modules/yauzl/fd-slicer.js"(exports) {
    var fs = __require("fs");
    var util = __require("util");
    var stream = __require("stream");
    var Readable = stream.Readable;
    var PassThrough = stream.PassThrough;
    var Pend = require_pend();
    var EventEmitter = __require("events").EventEmitter;
    exports.BufferSlicer = BufferSlicer;
    exports.FdSlicer = FdSlicer;
    util.inherits(FdSlicer, EventEmitter);
    function FdSlicer(fd) {
      EventEmitter.call(this);
      this.fd = fd;
      this.pend = new Pend();
      this.pend.max = 1;
      this.refCount = 0;
    }
    FdSlicer.prototype.read = function(buffer, offset, length, position, callback) {
      var self = this;
      self.pend.go(function(cb) {
        fs.read(self.fd, buffer, offset, length, position, function(err, bytesRead, buffer2) {
          cb();
          callback(err, bytesRead, buffer2);
        });
      });
    };
    FdSlicer.prototype.createReadStream = function(options2) {
      return new ReadStream(this, options2);
    };
    FdSlicer.prototype.ref = function() {
      this.refCount += 1;
    };
    FdSlicer.prototype.unref = function() {
      var self = this;
      self.refCount -= 1;
      if (self.refCount < 0) throw new Error("invalid unref");
      if (self.refCount > 0) return;
      fs.close(self.fd, onCloseDone);
      function onCloseDone(err) {
        if (err) {
          self.emit("error", err);
        } else {
          self.emit("close");
        }
      }
    };
    util.inherits(ReadStream, Readable);
    function ReadStream(context, options2) {
      options2 = options2 || {};
      Readable.call(this, options2);
      this.context = context;
      this.context.ref();
      this.start = options2.start || 0;
      this.endOffset = options2.end;
      this.pos = this.start;
    }
    ReadStream.prototype._read = function(n) {
      var self = this;
      var toRead = Math.min(self._readableState.highWaterMark, n);
      if (self.endOffset != null) {
        toRead = Math.min(toRead, self.endOffset - self.pos);
      }
      if (toRead <= 0) {
        self.push(null);
        this._cleanup();
        return;
      }
      self.context.pend.go(function(cb) {
        var buffer = Buffer.allocUnsafe(toRead);
        fs.read(self.context.fd, buffer, 0, toRead, self.pos, function(err, bytesRead) {
          if (err) {
            self.destroy(err);
          } else if (bytesRead === 0) {
            self.push(null);
            self._cleanup();
          } else {
            self.pos += bytesRead;
            self.push(buffer.slice(0, bytesRead));
          }
          cb();
        });
      });
    };
    ReadStream.prototype._destroy = function(err, cb) {
      this._cleanup();
      cb(err);
    };
    ReadStream.prototype._cleanup = function() {
      if (this.context != null) {
        this.context.unref();
        this.context = null;
      }
    };
    util.inherits(BufferSlicer, EventEmitter);
    function BufferSlicer(buffer) {
      EventEmitter.call(this);
      this.refCount = 0;
      this.buffer = buffer;
    }
    BufferSlicer.prototype.read = function(buffer, offset, length, position, callback) {
      if (!(0 <= offset && offset <= buffer.length)) throw new RangeError("offset outside buffer: 0 <= " + offset + " <= " + buffer.length);
      if (position < 0) throw new RangeError("position is negative: " + position);
      if (offset + length > buffer.length) {
        length = buffer.length - offset;
      }
      if (position + length > this.buffer.length) {
        length = this.buffer.length - position;
      }
      if (length <= 0) {
        setImmediate(function() {
          callback(null, 0);
        });
        return;
      }
      this.buffer.copy(buffer, offset, position, position + length);
      setImmediate(function() {
        callback(null, length);
      });
    };
    BufferSlicer.prototype.createReadStream = function(options2) {
      options2 = options2 || {};
      var readStream = new PassThrough(options2);
      readStream.start = options2.start || 0;
      readStream.endOffset = options2.end;
      readStream.pos = readStream.endOffset || this.buffer.length;
      var entireSlice = this.buffer.slice(readStream.start, readStream.pos);
      var maxChunkSize = 65536;
      var offset = 0;
      while (true) {
        var nextOffset = offset + maxChunkSize;
        if (nextOffset >= entireSlice.length) {
          if (offset < entireSlice.length) {
            readStream.write(entireSlice.slice(offset, entireSlice.length));
          }
          break;
        }
        readStream.write(entireSlice.slice(offset, nextOffset));
        offset = nextOffset;
      }
      readStream.end();
      return readStream;
    };
    BufferSlicer.prototype.ref = function() {
      this.refCount += 1;
    };
    BufferSlicer.prototype.unref = function() {
      this.refCount -= 1;
      if (this.refCount < 0) {
        throw new Error("invalid unref");
      }
    };
  }
});

// ../../node_modules/yauzl/crc32.js
var require_crc32 = __commonJS({
  "../../node_modules/yauzl/crc32.js"(exports, module) {
    var CRC_TABLE = new Int32Array([
      0,
      1996959894,
      3993919788,
      2567524794,
      124634137,
      1886057615,
      3915621685,
      2657392035,
      249268274,
      2044508324,
      3772115230,
      2547177864,
      162941995,
      2125561021,
      3887607047,
      2428444049,
      498536548,
      1789927666,
      4089016648,
      2227061214,
      450548861,
      1843258603,
      4107580753,
      2211677639,
      325883990,
      1684777152,
      4251122042,
      2321926636,
      335633487,
      1661365465,
      4195302755,
      2366115317,
      997073096,
      1281953886,
      3579855332,
      2724688242,
      1006888145,
      1258607687,
      3524101629,
      2768942443,
      901097722,
      1119000684,
      3686517206,
      2898065728,
      853044451,
      1172266101,
      3705015759,
      2882616665,
      651767980,
      1373503546,
      3369554304,
      3218104598,
      565507253,
      1454621731,
      3485111705,
      3099436303,
      671266974,
      1594198024,
      3322730930,
      2970347812,
      795835527,
      1483230225,
      3244367275,
      3060149565,
      1994146192,
      31158534,
      2563907772,
      4023717930,
      1907459465,
      112637215,
      2680153253,
      3904427059,
      2013776290,
      251722036,
      2517215374,
      3775830040,
      2137656763,
      141376813,
      2439277719,
      3865271297,
      1802195444,
      476864866,
      2238001368,
      4066508878,
      1812370925,
      453092731,
      2181625025,
      4111451223,
      1706088902,
      314042704,
      2344532202,
      4240017532,
      1658658271,
      366619977,
      2362670323,
      4224994405,
      1303535960,
      984961486,
      2747007092,
      3569037538,
      1256170817,
      1037604311,
      2765210733,
      3554079995,
      1131014506,
      879679996,
      2909243462,
      3663771856,
      1141124467,
      855842277,
      2852801631,
      3708648649,
      1342533948,
      654459306,
      3188396048,
      3373015174,
      1466479909,
      544179635,
      3110523913,
      3462522015,
      1591671054,
      702138776,
      2966460450,
      3352799412,
      1504918807,
      783551873,
      3082640443,
      3233442989,
      3988292384,
      2596254646,
      62317068,
      1957810842,
      3939845945,
      2647816111,
      81470997,
      1943803523,
      3814918930,
      2489596804,
      225274430,
      2053790376,
      3826175755,
      2466906013,
      167816743,
      2097651377,
      4027552580,
      2265490386,
      503444072,
      1762050814,
      4150417245,
      2154129355,
      426522225,
      1852507879,
      4275313526,
      2312317920,
      282753626,
      1742555852,
      4189708143,
      2394877945,
      397917763,
      1622183637,
      3604390888,
      2714866558,
      953729732,
      1340076626,
      3518719985,
      2797360999,
      1068828381,
      1219638859,
      3624741850,
      2936675148,
      906185462,
      1090812512,
      3747672003,
      2825379669,
      829329135,
      1181335161,
      3412177804,
      3160834842,
      628085408,
      1382605366,
      3423369109,
      3138078467,
      570562233,
      1426400815,
      3317316542,
      2998733608,
      733239954,
      1555261956,
      3268935591,
      3050360625,
      752459403,
      1541320221,
      2607071920,
      3965973030,
      1969922972,
      40735498,
      2617837225,
      3943577151,
      1913087877,
      83908371,
      2512341634,
      3803740692,
      2075208622,
      213261112,
      2463272603,
      3855990285,
      2094854071,
      198958881,
      2262029012,
      4057260610,
      1759359992,
      534414190,
      2176718541,
      4139329115,
      1873836001,
      414664567,
      2282248934,
      4279200368,
      1711684554,
      285281116,
      2405801727,
      4167216745,
      1634467795,
      376229701,
      2685067896,
      3608007406,
      1308918612,
      956543938,
      2808555105,
      3495958263,
      1231636301,
      1047427035,
      2932959818,
      3654703836,
      1088359270,
      936918e3,
      2847714899,
      3736837829,
      1202900863,
      817233897,
      3183342108,
      3401237130,
      1404277552,
      615818150,
      3134207493,
      3453421203,
      1423857449,
      601450431,
      3009837614,
      3294710456,
      1567103746,
      711928724,
      3020668471,
      3272380065,
      1510334235,
      755167117
    ]);
    function crc32(buf) {
      let crc = -1;
      for (let x of buf) {
        crc = CRC_TABLE[(crc ^ x) & 255] ^ crc >>> 8;
      }
      return (crc ^ -1) >>> 0;
    }
    module.exports = crc32;
  }
});

// ../../node_modules/yauzl/index.js
var require_yauzl = __commonJS({
  "../../node_modules/yauzl/index.js"(exports) {
    var fs = __require("fs");
    var zlib = __require("zlib");
    var fd_slicer = require_fd_slicer();
    var util = __require("util");
    var EventEmitter = __require("events").EventEmitter;
    var Transform2 = __require("stream").Transform;
    var PassThrough = __require("stream").PassThrough;
    var Writable = __require("stream").Writable;
    var crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : require_crc32();
    exports.open = open4;
    exports.fromFd = fromFd;
    exports.fromBuffer = fromBuffer;
    exports.fromRandomAccessReader = fromRandomAccessReader;
    exports.openPromise = openPromise;
    exports.fromFdPromise = fromFdPromise;
    exports.fromBufferPromise = fromBufferPromise;
    exports.fromRandomAccessReaderPromise = fromRandomAccessReaderPromise;
    exports.dosDateTimeToDate = dosDateTimeToDate;
    exports.getFileNameLowLevel = getFileNameLowLevel;
    exports.validateFileName = validateFileName;
    exports.parseExtraFields = parseExtraFields;
    exports.ZipFile = ZipFile;
    exports.Entry = Entry;
    exports.LocalFileHeader = LocalFileHeader;
    exports.RandomAccessReader = RandomAccessReader;
    function openPromise(path, options2) {
      return new Promise((resolve, reject) => {
        open4(path, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function fromFdPromise(fd, options2) {
      return new Promise((resolve, reject) => {
        fromFd(fd, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function fromBufferPromise(buffer, options2) {
      return new Promise((resolve, reject) => {
        fromBuffer(buffer, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function fromRandomAccessReaderPromise(reader, totalSize, options2) {
      return new Promise((resolve, reject) => {
        fromRandomAccessReader(reader, totalSize, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function open4(path, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = true;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      fs.open(path, "r", function(err, fd) {
        if (err) return callback(err);
        fromFd(fd, options2, function(err2, zipfile) {
          if (err2) fs.close(fd, defaultCallback);
          callback(err2, zipfile);
        });
      });
    }
    function fromFd(fd, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = false;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      fs.fstat(fd, function(err, stats) {
        if (err) return callback(err);
        var reader = new fd_slicer.FdSlicer(fd);
        fromRandomAccessReader(reader, stats.size, options2, callback);
      });
    }
    function fromBuffer(buffer, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      options2.autoClose = false;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      var reader = new fd_slicer.BufferSlicer(buffer);
      fromRandomAccessReader(reader, buffer.length, options2, callback);
    }
    function fromRandomAccessReader(reader, totalSize, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = true;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      var decodeStrings = !!options2.decodeStrings;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      if (typeof totalSize !== "number") throw new Error("expected totalSize parameter to be a number");
      if (totalSize > Number.MAX_SAFE_INTEGER) {
        throw new Error("zip file too large. only file sizes up to 2^52 are supported due to JavaScript's Number type being an IEEE 754 double.");
      }
      reader.ref();
      var eocdrWithoutCommentSize = 22;
      var zip64EocdlSize = 20;
      var maxCommentSize = 65535;
      var bufferSize = Math.min(zip64EocdlSize + eocdrWithoutCommentSize + maxCommentSize, totalSize);
      var buffer = newBuffer(bufferSize);
      var bufferReadStart = totalSize - buffer.length;
      readAndAssertNoEof(reader, buffer, 0, bufferSize, bufferReadStart, function(err) {
        if (err) return callback(err);
        for (var i = bufferSize - eocdrWithoutCommentSize; i >= 0; i -= 1) {
          if (buffer.readUInt32LE(i) !== 101010256) continue;
          var eocdrBuffer = buffer.subarray(i);
          var diskNumber = eocdrBuffer.readUInt16LE(4);
          var entryCount = eocdrBuffer.readUInt16LE(10);
          var centralDirectoryOffset = eocdrBuffer.readUInt32LE(16);
          var commentLength = eocdrBuffer.readUInt16LE(20);
          var expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize;
          if (commentLength !== expectedCommentLength) {
            return callback(new Error("Invalid comment length. Expected: " + expectedCommentLength + ". Found: " + commentLength + ". Are there extra bytes at the end of the file? Or is the end of central dir signature `PK☺☻` in the comment?"));
          }
          var comment = decodeStrings ? decodeBuffer(eocdrBuffer.subarray(22), false) : eocdrBuffer.subarray(22);
          if (i - zip64EocdlSize >= 0 && buffer.readUInt32LE(i - zip64EocdlSize) === 117853008) {
            var zip64EocdlBuffer = buffer.subarray(i - zip64EocdlSize, i - zip64EocdlSize + zip64EocdlSize);
            var zip64EocdrOffset = readUInt64LE(zip64EocdlBuffer, 8);
            var zip64EocdrBuffer = newBuffer(56);
            return readAndAssertNoEof(reader, zip64EocdrBuffer, 0, zip64EocdrBuffer.length, zip64EocdrOffset, function(err2) {
              if (err2) return callback(err2);
              if (zip64EocdrBuffer.readUInt32LE(0) !== 101075792) {
                return callback(new Error("invalid zip64 end of central directory record signature"));
              }
              diskNumber = zip64EocdrBuffer.readUInt32LE(16);
              if (diskNumber !== 0) {
                return callback(new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
              }
              entryCount = readUInt64LE(zip64EocdrBuffer, 32);
              centralDirectoryOffset = readUInt64LE(zip64EocdrBuffer, 48);
              return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options2.autoClose, options2.lazyEntries, decodeStrings, options2.validateEntrySizes, options2.strictFileNames));
            });
          }
          if (diskNumber !== 0) {
            return callback(new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
          }
          return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options2.autoClose, options2.lazyEntries, decodeStrings, options2.validateEntrySizes, options2.strictFileNames));
        }
        callback(new Error("End of central directory record signature not found. Either not a zip file, or file is truncated."));
      });
    }
    util.inherits(ZipFile, EventEmitter);
    function ZipFile(reader, centralDirectoryOffset, fileSize, entryCount, comment, autoClose, lazyEntries, decodeStrings, validateEntrySizes, strictFileNames) {
      var self = this;
      EventEmitter.call(self);
      self.reader = reader;
      self.reader.on("error", function(err) {
        emitError(self, err);
      });
      self.reader.once("close", function() {
        self.emit("close");
      });
      self.readEntryCursor = centralDirectoryOffset;
      self.fileSize = fileSize;
      self.entryCount = entryCount;
      self.comment = comment;
      self.entriesRead = 0;
      self.autoClose = !!autoClose;
      self.lazyEntries = !!lazyEntries;
      self.decodeStrings = !!decodeStrings;
      self.validateEntrySizes = !!validateEntrySizes;
      self.strictFileNames = !!strictFileNames;
      self.isOpen = true;
      self.emittedError = false;
      self.hasEachEntryBeenCalled = false;
      if (!self.lazyEntries) self._readEntry();
    }
    ZipFile.prototype.close = function() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.reader.unref();
    };
    function emitErrorAndAutoClose(self, err) {
      if (self.autoClose) self.close();
      emitError(self, err);
    }
    function emitError(self, err) {
      if (self.emittedError) return;
      self.emittedError = true;
      self.emit("error", err);
    }
    ZipFile.prototype.readEntry = function() {
      if (!this.lazyEntries) throw new Error("readEntry() called without lazyEntries:true");
      this._readEntry();
    };
    ZipFile.prototype._readEntry = function() {
      var self = this;
      if (self.entryCount === self.entriesRead) {
        setImmediate(function() {
          if (self.autoClose) self.close();
          if (self.emittedError) return;
          self.emit("end");
        });
        return;
      }
      if (self.emittedError) return;
      var buffer = newBuffer(46);
      readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err) {
        if (err) return emitErrorAndAutoClose(self, err);
        if (self.emittedError) return;
        var entry = new Entry();
        var signature = buffer.readUInt32LE(0);
        if (signature !== 33639248) return emitErrorAndAutoClose(self, new Error("invalid central directory file header signature: 0x" + signature.toString(16)));
        entry.versionMadeBy = buffer.readUInt16LE(4);
        entry.versionNeededToExtract = buffer.readUInt16LE(6);
        entry.generalPurposeBitFlag = buffer.readUInt16LE(8);
        entry.compressionMethod = buffer.readUInt16LE(10);
        entry.lastModFileTime = buffer.readUInt16LE(12);
        entry.lastModFileDate = buffer.readUInt16LE(14);
        entry.crc32 = buffer.readUInt32LE(16);
        entry.compressedSize = buffer.readUInt32LE(20);
        entry.uncompressedSize = buffer.readUInt32LE(24);
        entry.fileNameLength = buffer.readUInt16LE(28);
        entry.extraFieldLength = buffer.readUInt16LE(30);
        entry.fileCommentLength = buffer.readUInt16LE(32);
        entry.internalFileAttributes = buffer.readUInt16LE(36);
        entry.externalFileAttributes = buffer.readUInt32LE(38);
        entry.relativeOffsetOfLocalHeader = buffer.readUInt32LE(42);
        if (entry.generalPurposeBitFlag & 64) return emitErrorAndAutoClose(self, new Error("strong encryption is not supported"));
        self.readEntryCursor += 46;
        buffer = newBuffer(entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength);
        readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err2) {
          if (err2) return emitErrorAndAutoClose(self, err2);
          if (self.emittedError) return;
          entry.fileNameRaw = buffer.subarray(0, entry.fileNameLength);
          var fileCommentStart = entry.fileNameLength + entry.extraFieldLength;
          entry.extraFieldRaw = buffer.subarray(entry.fileNameLength, fileCommentStart);
          entry.fileCommentRaw = buffer.subarray(fileCommentStart, fileCommentStart + entry.fileCommentLength);
          try {
            entry.extraFields = parseExtraFields(entry.extraFieldRaw);
          } catch (err3) {
            return emitErrorAndAutoClose(self, err3);
          }
          if (self.decodeStrings) {
            var isUtf8 = (entry.generalPurposeBitFlag & 2048) !== 0;
            entry.fileComment = decodeBuffer(entry.fileCommentRaw, isUtf8);
            entry.fileName = getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, self.strictFileNames);
            var errorMessage = validateFileName(entry.fileName);
            if (errorMessage != null) return emitErrorAndAutoClose(self, new Error(errorMessage));
          } else {
            entry.fileComment = entry.fileCommentRaw;
            entry.fileName = entry.fileNameRaw;
          }
          entry.comment = entry.fileComment;
          self.readEntryCursor += buffer.length;
          self.entriesRead += 1;
          for (var i = 0; i < entry.extraFields.length; i++) {
            var extraField = entry.extraFields[i];
            if (extraField.id !== 1) continue;
            var zip64EiefBuffer = extraField.data;
            var index = 0;
            if (entry.uncompressedSize === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include uncompressed size"));
              }
              entry.uncompressedSize = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            if (entry.compressedSize === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include compressed size"));
              }
              entry.compressedSize = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            if (entry.relativeOffsetOfLocalHeader === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include relative header offset"));
              }
              entry.relativeOffsetOfLocalHeader = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            break;
          }
          if (self.validateEntrySizes && entry.compressionMethod === 0) {
            var expectedCompressedSize = entry.uncompressedSize;
            if (entry.isEncrypted()) {
              expectedCompressedSize += 12;
            }
            if (entry.compressedSize !== expectedCompressedSize) {
              var msg = "compressed/uncompressed size mismatch for stored file: " + entry.compressedSize + " != " + entry.uncompressedSize;
              return emitErrorAndAutoClose(self, new Error(msg));
            }
          }
          self.emit("entry", entry);
          if (!self.lazyEntries) self._readEntry();
        });
      });
    };
    ZipFile.prototype.eachEntry = function() {
      const self = this;
      if (!self.lazyEntries) throw new Error("eachEntry() requires lazyEntries: true");
      if (self.hasEachEntryBeenCalled) throw new Error("eachEntry() must only be called once per ZipFile");
      self.hasEachEntryBeenCalled = true;
      let pendingResolveReject = null;
      self.on("entry", onEntry);
      self.on("end", onEnd);
      self.on("error", onError);
      function cleanup() {
        self.removeListener("entry", onEntry);
        self.removeListener("end", onEnd);
        self.removeListener("error", onError);
        if (self.autoClose) self.close();
      }
      function onEntry(entry) {
        let { resolve } = pendingResolveReject;
        pendingResolveReject = null;
        resolve({ value: entry });
      }
      function onEnd() {
        let { resolve } = pendingResolveReject;
        pendingResolveReject = null;
        cleanup();
        resolve({ done: true });
      }
      function onError(err) {
        let { reject } = pendingResolveReject;
        pendingResolveReject = null;
        cleanup();
        reject(err);
      }
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          const promise = new Promise((resolve, reject) => {
            if (pendingResolveReject != null) throw new Error("next() called before previous Promise was resolved.");
            pendingResolveReject = { resolve, reject };
          });
          self.readEntry();
          return promise;
        },
        return(value) {
          cleanup();
          return Promise.resolve({ done: true, value });
        },
        throw(value) {
          cleanup();
          return Promise.reject(value);
        }
      };
    };
    ZipFile.prototype.openReadStream = function(entry, options2, callback) {
      var self = this;
      var relativeStart = 0;
      var relativeEnd = entry.compressedSize;
      if (callback == null) {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) {
        options2 = {};
      } else {
        if (options2.decodeFileData === false) {
          if (options2.decrypt != null) {
            throw new Error("cannot use options.decrypt when options.decodeFileData === false");
          }
          if (options2.decompress != null) {
            throw new Error("cannot use options.decompress when options.decodeFileData === false");
          }
        } else {
          if (options2.decrypt != null) {
            if (!entry.isEncrypted()) {
              throw new Error("options.decrypt can only be specified for encrypted entries. See also option decodeFileData.");
            }
            if (options2.decrypt !== false) throw new Error("invalid options.decrypt value: " + options2.decrypt);
            if (entry.isCompressed()) {
              if (options2.decompress !== false) throw new Error("entry is encrypted and compressed, and options.decompress !== false. See also option decodeFileData.");
            }
          }
          if (options2.decompress != null) {
            if (!entry.isCompressed()) {
              throw new Error("options.decompress can only be specified for compressed entries. See also option decodeFileData.");
            }
            if (!(options2.decompress === false || options2.decompress === true)) {
              throw new Error("invalid options.decompress value: " + options2.decompress);
            }
            decompress = options2.decompress;
          }
        }
        if (options2.start != null) {
          relativeStart = options2.start;
          if (relativeStart < 0) throw new Error("options.start < 0");
          if (relativeStart > entry.compressedSize) throw new Error("options.start > entry.compressedSize");
        }
        if (options2.end != null) {
          relativeEnd = options2.end;
          if (relativeEnd < 0) throw new Error("options.end < 0");
          if (relativeEnd > entry.compressedSize) throw new Error("options.end > entry.compressedSize");
          if (relativeEnd < relativeStart) throw new Error("options.end < options.start");
        }
      }
      var rawMode = options2.decodeFileData === false || // Explicitly requested raw.
      (entry.compressionMethod === 0 || // Naturally without compression.
      entry.compressionMethod === 8 && options2.decompress === false) && (!entry.isEncrypted() || // Naturally without encryption.
      options2.decrypt === false);
      if (options2.start != null || options2.end != null) {
        if (!rawMode) throw new Error("start/end range require options.decodeFileData === false for non-trivial encoded entries.");
      }
      if (!self.isOpen) return callback(new Error("closed"));
      if (entry.isEncrypted() && !rawMode) {
        if (options2.decrypt !== false) return callback(new Error("entry is encrypted, and options.decodeFileData !== false"));
      }
      var decompress;
      if (rawMode) {
        decompress = false;
      } else if (entry.compressionMethod === 8) {
        decompress = options2.decodeFileData !== true;
      } else {
        return callback(new Error("unsupported compression method: " + entry.compressionMethod));
      }
      self.readLocalFileHeader(entry, { minimal: true }, function(err, localFileHeader) {
        if (err) return callback(err);
        self.openReadStreamLowLevel(
          localFileHeader.fileDataStart,
          entry.compressedSize,
          relativeStart,
          relativeEnd,
          decompress,
          entry.uncompressedSize,
          callback
        );
      });
    };
    ZipFile.prototype.openReadStreamLowLevel = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, callback) {
      var self = this;
      var fileDataEnd = fileDataStart + compressedSize;
      var readStream = self.reader.createReadStream({
        start: fileDataStart + relativeStart,
        end: fileDataStart + relativeEnd
      });
      var endpointStream = readStream;
      if (decompress) {
        var destroyed = false;
        var inflateFilter = zlib.createInflateRaw();
        readStream.on("error", function(err) {
          setImmediate(function() {
            if (!destroyed) inflateFilter.emit("error", err);
          });
        });
        readStream.pipe(inflateFilter);
        if (self.validateEntrySizes) {
          endpointStream = new AssertByteCountStream(uncompressedSize);
          inflateFilter.on("error", function(err) {
            setImmediate(function() {
              if (!destroyed) endpointStream.emit("error", err);
            });
          });
          inflateFilter.pipe(endpointStream);
        } else {
          endpointStream = inflateFilter;
        }
        installDestroyFn(endpointStream, function() {
          destroyed = true;
          if (inflateFilter !== endpointStream) inflateFilter.unpipe(endpointStream);
          readStream.unpipe(inflateFilter);
          readStream.destroy();
        });
      }
      callback(null, endpointStream);
    };
    ZipFile.prototype.readLocalFileHeader = function(entry, options2, callback) {
      var self = this;
      if (callback == null) {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      self.reader.ref();
      var buffer = newBuffer(30);
      readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader, function(err) {
        try {
          if (err) return callback(err);
          var signature = buffer.readUInt32LE(0);
          if (signature !== 67324752) {
            return callback(new Error("invalid local file header signature: 0x" + signature.toString(16)));
          }
          var fileNameLength = buffer.readUInt16LE(26);
          var extraFieldLength = buffer.readUInt16LE(28);
          var fileDataStart = entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;
          if (fileDataStart + entry.compressedSize > self.fileSize) {
            return callback(new Error("file data overflows file bounds: " + fileDataStart + " + " + entry.compressedSize + " > " + self.fileSize));
          }
          if (options2.minimal) {
            return callback(null, { fileDataStart });
          }
          var localFileHeader = new LocalFileHeader();
          localFileHeader.fileDataStart = fileDataStart;
          localFileHeader.versionNeededToExtract = buffer.readUInt16LE(4);
          localFileHeader.generalPurposeBitFlag = buffer.readUInt16LE(6);
          localFileHeader.compressionMethod = buffer.readUInt16LE(8);
          localFileHeader.lastModFileTime = buffer.readUInt16LE(10);
          localFileHeader.lastModFileDate = buffer.readUInt16LE(12);
          localFileHeader.crc32 = buffer.readUInt32LE(14);
          localFileHeader.compressedSize = buffer.readUInt32LE(18);
          localFileHeader.uncompressedSize = buffer.readUInt32LE(22);
          localFileHeader.fileNameLength = fileNameLength;
          localFileHeader.extraFieldLength = extraFieldLength;
          buffer = newBuffer(fileNameLength + extraFieldLength);
          self.reader.ref();
          readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader + 30, function(err2) {
            try {
              if (err2) return callback(err2);
              localFileHeader.fileName = buffer.subarray(0, fileNameLength);
              localFileHeader.extraField = buffer.subarray(fileNameLength);
              return callback(null, localFileHeader);
            } finally {
              self.reader.unref();
            }
          });
        } finally {
          self.reader.unref();
        }
      });
    };
    ZipFile.prototype.openReadStreamPromise = function(entry, options2) {
      return new Promise((resolve, reject) => {
        this.openReadStream(entry, options2, function(err, readStream) {
          if (err) return reject(err);
          resolve(readStream);
        });
      });
    };
    ZipFile.prototype.openReadStreamLowLevelPromise = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize) {
      return new Promise((resolve, reject) => {
        this.openReadStream(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, function(err, readStream) {
          if (err) return reject(err);
          resolve(readStream);
        });
      });
    };
    ZipFile.prototype.readLocalFileHeaderPromise = function(entry, options2) {
      return new Promise((resolve, reject) => {
        this.readLocalFileHeader(entry, options2, function(err, localFileHeader) {
          if (err) return reject(err);
          resolve(localFileHeader);
        });
      });
    };
    function Entry() {
    }
    Entry.prototype.getLastModDate = function(options2) {
      if (options2 == null) options2 = {};
      if (!options2.forceDosFormat) {
        for (var i = 0; i < this.extraFields.length; i++) {
          var extraField = this.extraFields[i];
          if (extraField.id === 21589) {
            var data = extraField.data;
            if (data.length < 5) continue;
            var flags = data[0];
            var HAS_MTIME = 1;
            if (!(flags & HAS_MTIME)) continue;
            var posixTimestamp = data.readInt32LE(1);
            return new Date(posixTimestamp * 1e3);
          } else if (extraField.id === 10) {
            var data = extraField.data;
            if (data.length !== 32) continue;
            if (data.readUInt16LE(4) !== 1) continue;
            if (data.readUInt16LE(6) !== 24) continue;
            var hundredNanoSecondsSince1601 = data.readUInt32LE(8) + 4294967296 * data.readInt32LE(12);
            var millisecondsSince1970 = hundredNanoSecondsSince1601 / 1e4 - 116444736e5;
            return new Date(millisecondsSince1970);
          }
        }
      }
      return dosDateTimeToDate(this.lastModFileDate, this.lastModFileTime, options2.timezone);
    };
    Entry.prototype.canDecodeFileData = function() {
      return !this.isEncrypted() && (this.compressionMethod === 0 || this.compressionMethod === 8);
    };
    Entry.prototype.isEncrypted = function() {
      return (this.generalPurposeBitFlag & 1) !== 0;
    };
    Entry.prototype.isCompressed = function() {
      return this.compressionMethod === 8;
    };
    function LocalFileHeader() {
    }
    function dosDateTimeToDate(date, time2, timezone) {
      var day = date & 31;
      var month = (date >> 5 & 15) - 1;
      var year = (date >> 9 & 127) + 1980;
      var millisecond = 0;
      var second = (time2 & 31) * 2;
      var minute = time2 >> 5 & 63;
      var hour = time2 >> 11 & 31;
      if (timezone == null || timezone === "local") {
        return new Date(year, month, day, hour, minute, second, millisecond);
      } else if (timezone === "UTC") {
        return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
      } else {
        throw new Error("unrecognized options.timezone: " + options.timezone);
      }
    }
    function getFileNameLowLevel(generalPurposeBitFlag, fileNameBuffer, extraFields, strictFileNames) {
      var fileName = null;
      for (var i = 0; i < extraFields.length; i++) {
        var extraField = extraFields[i];
        if (extraField.id === 28789) {
          if (extraField.data.length < 6) {
            continue;
          }
          if (extraField.data.readUInt8(0) !== 1) {
            continue;
          }
          var oldNameCrc32 = extraField.data.readUInt32LE(1);
          if (crc32(fileNameBuffer) !== oldNameCrc32) {
            continue;
          }
          fileName = decodeBuffer(extraField.data.subarray(5), true);
          break;
        }
      }
      if (fileName == null) {
        var isUtf8 = (generalPurposeBitFlag & 2048) !== 0;
        fileName = decodeBuffer(fileNameBuffer, isUtf8);
      }
      if (!strictFileNames) {
        fileName = fileName.replace(/\\/g, "/");
      }
      return fileName;
    }
    function validateFileName(fileName) {
      if (fileName.indexOf("\\") !== -1) {
        return "invalid characters in fileName: " + fileName;
      }
      if (/^[a-zA-Z]:/.test(fileName) || /^\//.test(fileName)) {
        return "absolute path: " + fileName;
      }
      if (fileName.split("/").indexOf("..") !== -1) {
        return "invalid relative path: " + fileName;
      }
      return null;
    }
    function parseExtraFields(extraFieldBuffer) {
      var extraFields = [];
      var i = 0;
      while (i < extraFieldBuffer.length - 3) {
        var headerId = extraFieldBuffer.readUInt16LE(i + 0);
        var dataSize = extraFieldBuffer.readUInt16LE(i + 2);
        var dataStart = i + 4;
        var dataEnd = dataStart + dataSize;
        if (dataEnd > extraFieldBuffer.length) throw new Error("extra field length exceeds extra field buffer size");
        var dataBuffer = extraFieldBuffer.subarray(dataStart, dataEnd);
        extraFields.push({
          id: headerId,
          data: dataBuffer
        });
        i = dataEnd;
      }
      return extraFields;
    }
    function readAndAssertNoEof(reader, buffer, offset, length, position, callback) {
      if (length === 0) {
        return setImmediate(function() {
          callback(null, newBuffer(0));
        });
      }
      reader.read(buffer, offset, length, position, function(err, bytesRead) {
        if (err) return callback(err);
        if (bytesRead < length) {
          return callback(new Error("unexpected EOF"));
        }
        callback();
      });
    }
    util.inherits(AssertByteCountStream, Transform2);
    function AssertByteCountStream(byteCount) {
      Transform2.call(this);
      this.actualByteCount = 0;
      this.expectedByteCount = byteCount;
    }
    AssertByteCountStream.prototype._transform = function(chunk, encoding, cb) {
      this.actualByteCount += chunk.length;
      if (this.actualByteCount > this.expectedByteCount) {
        var msg = "too many bytes in the stream. expected " + this.expectedByteCount + ". got at least " + this.actualByteCount;
        return cb(new Error(msg));
      }
      cb(null, chunk);
    };
    AssertByteCountStream.prototype._flush = function(cb) {
      if (this.actualByteCount < this.expectedByteCount) {
        var msg = "not enough bytes in the stream. expected " + this.expectedByteCount + ". got only " + this.actualByteCount;
        return cb(new Error(msg));
      }
      cb();
    };
    util.inherits(RandomAccessReader, EventEmitter);
    function RandomAccessReader() {
      EventEmitter.call(this);
      this.refCount = 0;
    }
    RandomAccessReader.prototype.ref = function() {
      this.refCount += 1;
    };
    RandomAccessReader.prototype.unref = function() {
      var self = this;
      self.refCount -= 1;
      if (self.refCount > 0) return;
      if (self.refCount < 0) throw new Error("invalid unref");
      self.close(onCloseDone);
      function onCloseDone(err) {
        if (err) return self.emit("error", err);
        self.emit("close");
      }
    };
    RandomAccessReader.prototype.createReadStream = function(options2) {
      if (options2 == null) options2 = {};
      var start = options2.start;
      var end = options2.end;
      if (start === end) {
        var emptyStream = new PassThrough();
        setImmediate(function() {
          emptyStream.end();
        });
        return emptyStream;
      }
      var stream = this._readStreamForRange(start, end);
      var destroyed = false;
      var refUnrefFilter = new RefUnrefFilter(this);
      stream.on("error", function(err) {
        setImmediate(function() {
          if (!destroyed) refUnrefFilter.emit("error", err);
        });
      });
      installDestroyFn(refUnrefFilter, function() {
        stream.unpipe(refUnrefFilter);
        refUnrefFilter.unref();
        stream.destroy();
      });
      var byteCounter = new AssertByteCountStream(end - start);
      refUnrefFilter.on("error", function(err) {
        setImmediate(function() {
          if (!destroyed) byteCounter.emit("error", err);
        });
      });
      installDestroyFn(byteCounter, function() {
        destroyed = true;
        refUnrefFilter.unpipe(byteCounter);
        refUnrefFilter.destroy();
      });
      return stream.pipe(refUnrefFilter).pipe(byteCounter);
    };
    RandomAccessReader.prototype._readStreamForRange = function(start, end) {
      throw new Error("not implemented");
    };
    RandomAccessReader.prototype.read = function(buffer, offset, length, position, callback) {
      var readStream = this.createReadStream({ start: position, end: position + length });
      var writeStream = new Writable();
      var written = 0;
      writeStream._write = function(chunk, encoding, cb) {
        chunk.copy(buffer, offset + written, 0, chunk.length);
        written += chunk.length;
        cb();
      };
      writeStream.on("finish", callback);
      readStream.on("error", function(error) {
        callback(error);
      });
      readStream.pipe(writeStream);
    };
    RandomAccessReader.prototype.close = function(callback) {
      setImmediate(callback);
    };
    util.inherits(RefUnrefFilter, PassThrough);
    function RefUnrefFilter(context) {
      PassThrough.call(this);
      this.context = context;
      this.context.ref();
      this.unreffedYet = false;
    }
    RefUnrefFilter.prototype._flush = function(cb) {
      this.unref();
      cb();
    };
    RefUnrefFilter.prototype.unref = function(cb) {
      if (this.unreffedYet) return;
      this.unreffedYet = true;
      this.context.unref();
    };
    var cp437 = "\0☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
    function decodeBuffer(buffer, isUtf8) {
      if (isUtf8) {
        return buffer.toString("utf8");
      } else {
        var result = "";
        for (var i = 0; i < buffer.length; i++) {
          result += cp437[buffer[i]];
        }
        return result;
      }
    }
    function readUInt64LE(buffer, offset) {
      var lower32 = buffer.readUInt32LE(offset);
      var upper32 = buffer.readUInt32LE(offset + 4);
      return upper32 * 4294967296 + lower32;
    }
    var newBuffer;
    if (typeof Buffer.allocUnsafe === "function") {
      newBuffer = function(len) {
        return Buffer.allocUnsafe(len);
      };
    } else {
      newBuffer = function(len) {
        return new Buffer(len);
      };
    }
    function installDestroyFn(stream, fn) {
      if (typeof stream.destroy === "function") {
        stream._destroy = function(err, cb) {
          fn();
          if (cb != null) cb(err);
        };
      } else {
        stream.destroy = fn;
      }
    }
    function defaultCallback(err) {
      if (err) throw err;
    }
  }
});

// ../../node_modules/buffer-crc32/dist/index.cjs
var require_dist = __commonJS({
  "../../node_modules/buffer-crc32/dist/index.cjs"(exports, module) {
    "use strict";
    function getDefaultExportFromCjs(x) {
      return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
    }
    var CRC_TABLE = new Int32Array([
      0,
      1996959894,
      3993919788,
      2567524794,
      124634137,
      1886057615,
      3915621685,
      2657392035,
      249268274,
      2044508324,
      3772115230,
      2547177864,
      162941995,
      2125561021,
      3887607047,
      2428444049,
      498536548,
      1789927666,
      4089016648,
      2227061214,
      450548861,
      1843258603,
      4107580753,
      2211677639,
      325883990,
      1684777152,
      4251122042,
      2321926636,
      335633487,
      1661365465,
      4195302755,
      2366115317,
      997073096,
      1281953886,
      3579855332,
      2724688242,
      1006888145,
      1258607687,
      3524101629,
      2768942443,
      901097722,
      1119000684,
      3686517206,
      2898065728,
      853044451,
      1172266101,
      3705015759,
      2882616665,
      651767980,
      1373503546,
      3369554304,
      3218104598,
      565507253,
      1454621731,
      3485111705,
      3099436303,
      671266974,
      1594198024,
      3322730930,
      2970347812,
      795835527,
      1483230225,
      3244367275,
      3060149565,
      1994146192,
      31158534,
      2563907772,
      4023717930,
      1907459465,
      112637215,
      2680153253,
      3904427059,
      2013776290,
      251722036,
      2517215374,
      3775830040,
      2137656763,
      141376813,
      2439277719,
      3865271297,
      1802195444,
      476864866,
      2238001368,
      4066508878,
      1812370925,
      453092731,
      2181625025,
      4111451223,
      1706088902,
      314042704,
      2344532202,
      4240017532,
      1658658271,
      366619977,
      2362670323,
      4224994405,
      1303535960,
      984961486,
      2747007092,
      3569037538,
      1256170817,
      1037604311,
      2765210733,
      3554079995,
      1131014506,
      879679996,
      2909243462,
      3663771856,
      1141124467,
      855842277,
      2852801631,
      3708648649,
      1342533948,
      654459306,
      3188396048,
      3373015174,
      1466479909,
      544179635,
      3110523913,
      3462522015,
      1591671054,
      702138776,
      2966460450,
      3352799412,
      1504918807,
      783551873,
      3082640443,
      3233442989,
      3988292384,
      2596254646,
      62317068,
      1957810842,
      3939845945,
      2647816111,
      81470997,
      1943803523,
      3814918930,
      2489596804,
      225274430,
      2053790376,
      3826175755,
      2466906013,
      167816743,
      2097651377,
      4027552580,
      2265490386,
      503444072,
      1762050814,
      4150417245,
      2154129355,
      426522225,
      1852507879,
      4275313526,
      2312317920,
      282753626,
      1742555852,
      4189708143,
      2394877945,
      397917763,
      1622183637,
      3604390888,
      2714866558,
      953729732,
      1340076626,
      3518719985,
      2797360999,
      1068828381,
      1219638859,
      3624741850,
      2936675148,
      906185462,
      1090812512,
      3747672003,
      2825379669,
      829329135,
      1181335161,
      3412177804,
      3160834842,
      628085408,
      1382605366,
      3423369109,
      3138078467,
      570562233,
      1426400815,
      3317316542,
      2998733608,
      733239954,
      1555261956,
      3268935591,
      3050360625,
      752459403,
      1541320221,
      2607071920,
      3965973030,
      1969922972,
      40735498,
      2617837225,
      3943577151,
      1913087877,
      83908371,
      2512341634,
      3803740692,
      2075208622,
      213261112,
      2463272603,
      3855990285,
      2094854071,
      198958881,
      2262029012,
      4057260610,
      1759359992,
      534414190,
      2176718541,
      4139329115,
      1873836001,
      414664567,
      2282248934,
      4279200368,
      1711684554,
      285281116,
      2405801727,
      4167216745,
      1634467795,
      376229701,
      2685067896,
      3608007406,
      1308918612,
      956543938,
      2808555105,
      3495958263,
      1231636301,
      1047427035,
      2932959818,
      3654703836,
      1088359270,
      936918e3,
      2847714899,
      3736837829,
      1202900863,
      817233897,
      3183342108,
      3401237130,
      1404277552,
      615818150,
      3134207493,
      3453421203,
      1423857449,
      601450431,
      3009837614,
      3294710456,
      1567103746,
      711928724,
      3020668471,
      3272380065,
      1510334235,
      755167117
    ]);
    function ensureBuffer(input) {
      if (Buffer.isBuffer(input)) {
        return input;
      }
      if (typeof input === "number") {
        return Buffer.alloc(input);
      } else if (typeof input === "string") {
        return Buffer.from(input);
      } else {
        throw new Error("input must be buffer, number, or string, received " + typeof input);
      }
    }
    function bufferizeInt(num) {
      const tmp = ensureBuffer(4);
      tmp.writeInt32BE(num, 0);
      return tmp;
    }
    function _crc32(buf, previous) {
      buf = ensureBuffer(buf);
      if (Buffer.isBuffer(previous)) {
        previous = previous.readUInt32BE(0);
      }
      let crc = ~~previous ^ -1;
      for (var n = 0; n < buf.length; n++) {
        crc = CRC_TABLE[(crc ^ buf[n]) & 255] ^ crc >>> 8;
      }
      return crc ^ -1;
    }
    function crc32() {
      return bufferizeInt(_crc32.apply(null, arguments));
    }
    crc32.signed = function() {
      return _crc32.apply(null, arguments);
    };
    crc32.unsigned = function() {
      return _crc32.apply(null, arguments) >>> 0;
    };
    var bufferCrc32 = crc32;
    var index = /* @__PURE__ */ getDefaultExportFromCjs(bufferCrc32);
    module.exports = index;
  }
});

// ../../node_modules/yazl/index.js
var require_yazl = __commonJS({
  "../../node_modules/yazl/index.js"(exports) {
    var fs = __require("fs");
    var Transform2 = __require("stream").Transform;
    var PassThrough = __require("stream").PassThrough;
    var zlib = __require("zlib");
    var util = __require("util");
    var EventEmitter = __require("events").EventEmitter;
    var errorMonitor = __require("events").errorMonitor;
    var crc32 = require_dist();
    exports.ZipFile = ZipFile;
    exports.dateToDosDateTime = dateToDosDateTime;
    util.inherits(ZipFile, EventEmitter);
    function ZipFile() {
      this.outputStream = new PassThrough();
      this.entries = [];
      this.outputStreamCursor = 0;
      this.ended = false;
      this.allDone = false;
      this.forceZip64Eocd = false;
      this.errored = false;
      this.on(errorMonitor, function() {
        this.errored = true;
      });
    }
    ZipFile.prototype.addFile = function(realPath, metadataPath, options2) {
      var self = this;
      metadataPath = validateMetadataPath(metadataPath, false);
      if (options2 == null) options2 = {};
      if (shouldIgnoreAdding(self)) return;
      var entry = new Entry(metadataPath, false, options2);
      self.entries.push(entry);
      fs.stat(realPath, function(err, stats) {
        if (err) return self.emit("error", err);
        if (!stats.isFile()) return self.emit("error", new Error("not a file: " + realPath));
        entry.uncompressedSize = stats.size;
        if (options2.mtime == null) entry.setLastModDate(stats.mtime);
        if (options2.mode == null) entry.setFileAttributesMode(stats.mode);
        entry.setFileDataPumpFunction(function() {
          var readStream = fs.createReadStream(realPath);
          entry.state = Entry.FILE_DATA_IN_PROGRESS;
          readStream.on("error", function(err2) {
            self.emit("error", err2);
          });
          pumpFileDataReadStream(self, entry, readStream);
        });
        pumpEntries(self);
      });
    };
    ZipFile.prototype.addReadStream = function(readStream, metadataPath, options2) {
      this.addReadStreamLazy(metadataPath, options2, function(cb) {
        cb(null, readStream);
      });
    };
    ZipFile.prototype.addReadStreamLazy = function(metadataPath, options2, getReadStreamFunction) {
      var self = this;
      if (typeof options2 === "function") {
        getReadStreamFunction = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      metadataPath = validateMetadataPath(metadataPath, false);
      if (shouldIgnoreAdding(self)) return;
      var entry = new Entry(metadataPath, false, options2);
      self.entries.push(entry);
      entry.setFileDataPumpFunction(function() {
        entry.state = Entry.FILE_DATA_IN_PROGRESS;
        getReadStreamFunction(function(err, readStream) {
          if (err) return self.emit("error", err);
          pumpFileDataReadStream(self, entry, readStream);
        });
      });
      pumpEntries(self);
    };
    ZipFile.prototype.addBuffer = function(buffer, metadataPath, options2) {
      var self = this;
      metadataPath = validateMetadataPath(metadataPath, false);
      if (buffer.length > 1073741823) throw new Error("buffer too large: " + buffer.length + " > 1073741823");
      if (options2 == null) options2 = {};
      if (options2.size != null) throw new Error("options.size not allowed");
      if (shouldIgnoreAdding(self)) return;
      var entry = new Entry(metadataPath, false, options2);
      entry.uncompressedSize = buffer.length;
      entry.crc32 = crc32.unsigned(buffer);
      entry.crcAndFileSizeKnown = true;
      self.entries.push(entry);
      if (entry.compressionLevel === 0) {
        setCompressedBuffer(buffer);
      } else {
        zlib.deflateRaw(buffer, { level: entry.compressionLevel }, function(err, compressedBuffer) {
          setCompressedBuffer(compressedBuffer);
        });
      }
      function setCompressedBuffer(compressedBuffer) {
        entry.compressedSize = compressedBuffer.length;
        entry.setFileDataPumpFunction(function() {
          writeToOutputStream(self, compressedBuffer);
          writeToOutputStream(self, entry.getDataDescriptor());
          entry.state = Entry.FILE_DATA_DONE;
          setImmediate(function() {
            pumpEntries(self);
          });
        });
        pumpEntries(self);
      }
    };
    ZipFile.prototype.addEmptyDirectory = function(metadataPath, options2) {
      var self = this;
      metadataPath = validateMetadataPath(metadataPath, true);
      if (options2 == null) options2 = {};
      if (options2.size != null) throw new Error("options.size not allowed");
      if (options2.compress != null) throw new Error("options.compress not allowed");
      if (options2.compressionLevel != null) throw new Error("options.compressionLevel not allowed");
      if (shouldIgnoreAdding(self)) return;
      var entry = new Entry(metadataPath, true, options2);
      self.entries.push(entry);
      entry.setFileDataPumpFunction(function() {
        writeToOutputStream(self, entry.getDataDescriptor());
        entry.state = Entry.FILE_DATA_DONE;
        pumpEntries(self);
      });
      pumpEntries(self);
    };
    var eocdrSignatureBuffer = bufferFrom([80, 75, 5, 6]);
    ZipFile.prototype.end = function(options2, calculatedTotalSizeCallback) {
      if (typeof options2 === "function") {
        calculatedTotalSizeCallback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (this.ended) return;
      this.ended = true;
      if (this.errored) return;
      this.calculatedTotalSizeCallback = calculatedTotalSizeCallback;
      this.forceZip64Eocd = !!options2.forceZip64Format;
      if (options2.comment) {
        if (typeof options2.comment === "string") {
          this.comment = encodeCp437(options2.comment);
        } else {
          this.comment = options2.comment;
        }
        if (this.comment.length > 65535) throw new Error("comment is too large");
        if (bufferIncludes(this.comment, eocdrSignatureBuffer)) throw new Error("comment contains end of central directory record signature");
      } else {
        this.comment = EMPTY_BUFFER;
      }
      pumpEntries(this);
    };
    function writeToOutputStream(self, buffer) {
      self.outputStream.write(buffer);
      self.outputStreamCursor += buffer.length;
    }
    function pumpFileDataReadStream(self, entry, readStream) {
      var crc32Watcher = new Crc32Watcher();
      var uncompressedSizeCounter = new ByteCounter();
      var compressor = entry.compressionLevel !== 0 ? new zlib.DeflateRaw({ level: entry.compressionLevel }) : new PassThrough();
      var compressedSizeCounter = new ByteCounter();
      readStream.pipe(crc32Watcher).pipe(uncompressedSizeCounter).pipe(compressor).pipe(compressedSizeCounter).pipe(self.outputStream, { end: false });
      compressedSizeCounter.on("end", function() {
        entry.crc32 = crc32Watcher.crc32;
        if (entry.uncompressedSize == null) {
          entry.uncompressedSize = uncompressedSizeCounter.byteCount;
        } else {
          if (entry.uncompressedSize !== uncompressedSizeCounter.byteCount) return self.emit("error", new Error("file data stream has unexpected number of bytes"));
        }
        entry.compressedSize = compressedSizeCounter.byteCount;
        self.outputStreamCursor += entry.compressedSize;
        writeToOutputStream(self, entry.getDataDescriptor());
        entry.state = Entry.FILE_DATA_DONE;
        pumpEntries(self);
      });
    }
    function determineCompressionLevel(options2) {
      if (options2.compress != null && options2.compressionLevel != null) {
        if (!!options2.compress !== !!options2.compressionLevel) throw new Error("conflicting settings for compress and compressionLevel");
      }
      if (options2.compressionLevel != null) return options2.compressionLevel;
      if (options2.compress === false) return 0;
      return 6;
    }
    function pumpEntries(self) {
      if (self.allDone || self.errored) return;
      if (self.ended && self.calculatedTotalSizeCallback != null) {
        var calculatedTotalSize = calculateTotalSize(self);
        if (calculatedTotalSize != null) {
          self.calculatedTotalSizeCallback(calculatedTotalSize);
          self.calculatedTotalSizeCallback = null;
        }
      }
      var entry = getFirstNotDoneEntry();
      function getFirstNotDoneEntry() {
        for (var i = 0; i < self.entries.length; i++) {
          var entry2 = self.entries[i];
          if (entry2.state < Entry.FILE_DATA_DONE) return entry2;
        }
        return null;
      }
      if (entry != null) {
        if (entry.state < Entry.READY_TO_PUMP_FILE_DATA) return;
        if (entry.state === Entry.FILE_DATA_IN_PROGRESS) return;
        entry.relativeOffsetOfLocalHeader = self.outputStreamCursor;
        var localFileHeader = entry.getLocalFileHeader();
        writeToOutputStream(self, localFileHeader);
        entry.doFileDataPump();
      } else {
        if (self.ended) {
          self.offsetOfStartOfCentralDirectory = self.outputStreamCursor;
          self.entries.forEach(function(entry2) {
            var centralDirectoryRecord = entry2.getCentralDirectoryRecord();
            writeToOutputStream(self, centralDirectoryRecord);
          });
          writeToOutputStream(self, getEndOfCentralDirectoryRecord(self));
          self.outputStream.end();
          self.allDone = true;
        }
      }
    }
    function calculateTotalSize(self) {
      var pretendOutputCursor = 0;
      var centralDirectorySize = 0;
      for (var i = 0; i < self.entries.length; i++) {
        var entry = self.entries[i];
        if (entry.compressionLevel !== 0) return -1;
        if (entry.state >= Entry.READY_TO_PUMP_FILE_DATA) {
          if (entry.uncompressedSize == null) return -1;
        } else {
          if (entry.uncompressedSize == null) return null;
        }
        entry.relativeOffsetOfLocalHeader = pretendOutputCursor;
        var useZip64Format = entry.useZip64Format();
        pretendOutputCursor += LOCAL_FILE_HEADER_FIXED_SIZE + entry.utf8FileName.length;
        pretendOutputCursor += entry.uncompressedSize;
        if (!entry.crcAndFileSizeKnown) {
          if (useZip64Format) {
            pretendOutputCursor += ZIP64_DATA_DESCRIPTOR_SIZE;
          } else {
            pretendOutputCursor += DATA_DESCRIPTOR_SIZE;
          }
        }
        centralDirectorySize += CENTRAL_DIRECTORY_RECORD_FIXED_SIZE + entry.utf8FileName.length + entry.fileComment.length;
        if (!entry.forceDosTimestamp) {
          centralDirectorySize += INFO_ZIP_UNIVERSAL_TIMESTAMP_EXTRA_FIELD_SIZE;
        }
        if (useZip64Format) {
          centralDirectorySize += ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE;
        }
      }
      var endOfCentralDirectorySize = 0;
      if (self.forceZip64Eocd || self.entries.length >= 65535 || centralDirectorySize >= 65535 || pretendOutputCursor >= 4294967295) {
        endOfCentralDirectorySize += ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE + ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE;
      }
      endOfCentralDirectorySize += END_OF_CENTRAL_DIRECTORY_RECORD_SIZE + self.comment.length;
      return pretendOutputCursor + centralDirectorySize + endOfCentralDirectorySize;
    }
    function shouldIgnoreAdding(self) {
      if (self.ended) throw new Error("cannot add entries after calling end()");
      if (self.errored) return true;
      return false;
    }
    var ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE = 56;
    var ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE = 20;
    var END_OF_CENTRAL_DIRECTORY_RECORD_SIZE = 22;
    function getEndOfCentralDirectoryRecord(self, actuallyJustTellMeHowLongItWouldBe) {
      var needZip64Format = false;
      var normalEntriesLength = self.entries.length;
      if (self.forceZip64Eocd || self.entries.length >= 65535) {
        normalEntriesLength = 65535;
        needZip64Format = true;
      }
      var sizeOfCentralDirectory = self.outputStreamCursor - self.offsetOfStartOfCentralDirectory;
      var normalSizeOfCentralDirectory = sizeOfCentralDirectory;
      if (self.forceZip64Eocd || sizeOfCentralDirectory >= 4294967295) {
        normalSizeOfCentralDirectory = 4294967295;
        needZip64Format = true;
      }
      var normalOffsetOfStartOfCentralDirectory = self.offsetOfStartOfCentralDirectory;
      if (self.forceZip64Eocd || self.offsetOfStartOfCentralDirectory >= 4294967295) {
        normalOffsetOfStartOfCentralDirectory = 4294967295;
        needZip64Format = true;
      }
      if (actuallyJustTellMeHowLongItWouldBe) {
        if (needZip64Format) {
          return ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE + ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE + END_OF_CENTRAL_DIRECTORY_RECORD_SIZE;
        } else {
          return END_OF_CENTRAL_DIRECTORY_RECORD_SIZE;
        }
      }
      var eocdrBuffer = bufferAlloc(END_OF_CENTRAL_DIRECTORY_RECORD_SIZE + self.comment.length);
      eocdrBuffer.writeUInt32LE(101010256, 0);
      eocdrBuffer.writeUInt16LE(0, 4);
      eocdrBuffer.writeUInt16LE(0, 6);
      eocdrBuffer.writeUInt16LE(normalEntriesLength, 8);
      eocdrBuffer.writeUInt16LE(normalEntriesLength, 10);
      eocdrBuffer.writeUInt32LE(normalSizeOfCentralDirectory, 12);
      eocdrBuffer.writeUInt32LE(normalOffsetOfStartOfCentralDirectory, 16);
      eocdrBuffer.writeUInt16LE(self.comment.length, 20);
      self.comment.copy(eocdrBuffer, 22);
      if (!needZip64Format) return eocdrBuffer;
      var zip64EocdrBuffer = bufferAlloc(ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE);
      zip64EocdrBuffer.writeUInt32LE(101075792, 0);
      writeUInt64LE(zip64EocdrBuffer, ZIP64_END_OF_CENTRAL_DIRECTORY_RECORD_SIZE - 12, 4);
      zip64EocdrBuffer.writeUInt16LE(VERSION_MADE_BY, 12);
      zip64EocdrBuffer.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT_ZIP64, 14);
      zip64EocdrBuffer.writeUInt32LE(0, 16);
      zip64EocdrBuffer.writeUInt32LE(0, 20);
      writeUInt64LE(zip64EocdrBuffer, self.entries.length, 24);
      writeUInt64LE(zip64EocdrBuffer, self.entries.length, 32);
      writeUInt64LE(zip64EocdrBuffer, sizeOfCentralDirectory, 40);
      writeUInt64LE(zip64EocdrBuffer, self.offsetOfStartOfCentralDirectory, 48);
      var zip64EocdlBuffer = bufferAlloc(ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE);
      zip64EocdlBuffer.writeUInt32LE(117853008, 0);
      zip64EocdlBuffer.writeUInt32LE(0, 4);
      writeUInt64LE(zip64EocdlBuffer, self.outputStreamCursor, 8);
      zip64EocdlBuffer.writeUInt32LE(1, 16);
      return Buffer.concat([
        zip64EocdrBuffer,
        zip64EocdlBuffer,
        eocdrBuffer
      ]);
    }
    function validateMetadataPath(metadataPath, isDirectory) {
      if (metadataPath === "") throw new Error("empty metadataPath");
      metadataPath = metadataPath.replace(/\\/g, "/");
      if (/^[a-zA-Z]:/.test(metadataPath) || /^\//.test(metadataPath)) throw new Error("absolute path: " + metadataPath);
      if (metadataPath.split("/").indexOf("..") !== -1) throw new Error("invalid relative path: " + metadataPath);
      var looksLikeDirectory = /\/$/.test(metadataPath);
      if (isDirectory) {
        if (!looksLikeDirectory) metadataPath += "/";
      } else {
        if (looksLikeDirectory) throw new Error("file path cannot end with '/': " + metadataPath);
      }
      return metadataPath;
    }
    var EMPTY_BUFFER = bufferAlloc(0);
    function Entry(metadataPath, isDirectory, options2) {
      this.utf8FileName = bufferFrom(metadataPath);
      if (this.utf8FileName.length > 65535) throw new Error("utf8 file name too long. " + utf8FileName.length + " > 65535");
      this.isDirectory = isDirectory;
      this.state = Entry.WAITING_FOR_METADATA;
      this.setLastModDate(options2.mtime != null ? options2.mtime : /* @__PURE__ */ new Date());
      this.forceDosTimestamp = !!options2.forceDosTimestamp;
      if (options2.mode != null) {
        this.setFileAttributesMode(options2.mode);
      } else {
        this.setFileAttributesMode(isDirectory ? 16893 : 33204);
      }
      if (isDirectory) {
        this.crcAndFileSizeKnown = true;
        this.crc32 = 0;
        this.uncompressedSize = 0;
        this.compressedSize = 0;
      } else {
        this.crcAndFileSizeKnown = false;
        this.crc32 = null;
        this.uncompressedSize = null;
        this.compressedSize = null;
        if (options2.size != null) this.uncompressedSize = options2.size;
      }
      if (isDirectory) {
        this.compressionLevel = 0;
      } else {
        this.compressionLevel = determineCompressionLevel(options2);
      }
      this.forceZip64Format = !!options2.forceZip64Format;
      if (options2.fileComment) {
        if (typeof options2.fileComment === "string") {
          this.fileComment = bufferFrom(options2.fileComment, "utf-8");
        } else {
          this.fileComment = options2.fileComment;
        }
        if (this.fileComment.length > 65535) throw new Error("fileComment is too large");
      } else {
        this.fileComment = EMPTY_BUFFER;
      }
    }
    Entry.WAITING_FOR_METADATA = 0;
    Entry.READY_TO_PUMP_FILE_DATA = 1;
    Entry.FILE_DATA_IN_PROGRESS = 2;
    Entry.FILE_DATA_DONE = 3;
    Entry.prototype.setLastModDate = function(date) {
      this.mtime = date;
      var dosDateTime = dateToDosDateTime(date);
      this.lastModFileTime = dosDateTime.time;
      this.lastModFileDate = dosDateTime.date;
    };
    Entry.prototype.setFileAttributesMode = function(mode) {
      if ((mode & 65535) !== mode) throw new Error("invalid mode. expected: 0 <= " + mode + " <= 65535");
      this.externalFileAttributes = mode << 16 >>> 0;
    };
    Entry.prototype.setFileDataPumpFunction = function(doFileDataPump) {
      this.doFileDataPump = doFileDataPump;
      this.state = Entry.READY_TO_PUMP_FILE_DATA;
    };
    Entry.prototype.useZip64Format = function() {
      return this.forceZip64Format || this.uncompressedSize != null && this.uncompressedSize > 4294967294 || this.compressedSize != null && this.compressedSize > 4294967294 || this.relativeOffsetOfLocalHeader != null && this.relativeOffsetOfLocalHeader > 4294967294;
    };
    var LOCAL_FILE_HEADER_FIXED_SIZE = 30;
    var VERSION_NEEDED_TO_EXTRACT_UTF8 = 20;
    var VERSION_NEEDED_TO_EXTRACT_ZIP64 = 45;
    var VERSION_MADE_BY = 3 << 8 | 63;
    var FILE_NAME_IS_UTF8 = 1 << 11;
    var UNKNOWN_CRC32_AND_FILE_SIZES = 1 << 3;
    Entry.prototype.getLocalFileHeader = function() {
      var crc322 = 0;
      var compressedSize = 0;
      var uncompressedSize = 0;
      if (this.crcAndFileSizeKnown) {
        crc322 = this.crc32;
        compressedSize = this.compressedSize;
        uncompressedSize = this.uncompressedSize;
      }
      var fixedSizeStuff = bufferAlloc(LOCAL_FILE_HEADER_FIXED_SIZE);
      var generalPurposeBitFlag = FILE_NAME_IS_UTF8;
      if (!this.crcAndFileSizeKnown) generalPurposeBitFlag |= UNKNOWN_CRC32_AND_FILE_SIZES;
      fixedSizeStuff.writeUInt32LE(67324752, 0);
      fixedSizeStuff.writeUInt16LE(VERSION_NEEDED_TO_EXTRACT_UTF8, 4);
      fixedSizeStuff.writeUInt16LE(generalPurposeBitFlag, 6);
      fixedSizeStuff.writeUInt16LE(this.getCompressionMethod(), 8);
      fixedSizeStuff.writeUInt16LE(this.lastModFileTime, 10);
      fixedSizeStuff.writeUInt16LE(this.lastModFileDate, 12);
      fixedSizeStuff.writeUInt32LE(crc322, 14);
      fixedSizeStuff.writeUInt32LE(compressedSize, 18);
      fixedSizeStuff.writeUInt32LE(uncompressedSize, 22);
      fixedSizeStuff.writeUInt16LE(this.utf8FileName.length, 26);
      fixedSizeStuff.writeUInt16LE(0, 28);
      return Buffer.concat([
        fixedSizeStuff,
        // file name (variable size)
        this.utf8FileName
        // extra field (variable size)
        // no extra fields
      ]);
    };
    var DATA_DESCRIPTOR_SIZE = 16;
    var ZIP64_DATA_DESCRIPTOR_SIZE = 24;
    Entry.prototype.getDataDescriptor = function() {
      if (this.crcAndFileSizeKnown) {
        return EMPTY_BUFFER;
      }
      if (!this.useZip64Format()) {
        var buffer = bufferAlloc(DATA_DESCRIPTOR_SIZE);
        buffer.writeUInt32LE(134695760, 0);
        buffer.writeUInt32LE(this.crc32, 4);
        buffer.writeUInt32LE(this.compressedSize, 8);
        buffer.writeUInt32LE(this.uncompressedSize, 12);
        return buffer;
      } else {
        var buffer = bufferAlloc(ZIP64_DATA_DESCRIPTOR_SIZE);
        buffer.writeUInt32LE(134695760, 0);
        buffer.writeUInt32LE(this.crc32, 4);
        writeUInt64LE(buffer, this.compressedSize, 8);
        writeUInt64LE(buffer, this.uncompressedSize, 16);
        return buffer;
      }
    };
    var CENTRAL_DIRECTORY_RECORD_FIXED_SIZE = 46;
    var INFO_ZIP_UNIVERSAL_TIMESTAMP_EXTRA_FIELD_SIZE = 9;
    var ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE = 28;
    Entry.prototype.getCentralDirectoryRecord = function() {
      var fixedSizeStuff = bufferAlloc(CENTRAL_DIRECTORY_RECORD_FIXED_SIZE);
      var generalPurposeBitFlag = FILE_NAME_IS_UTF8;
      if (!this.crcAndFileSizeKnown) generalPurposeBitFlag |= UNKNOWN_CRC32_AND_FILE_SIZES;
      var izutefBuffer = EMPTY_BUFFER;
      if (!this.forceDosTimestamp) {
        izutefBuffer = bufferAlloc(INFO_ZIP_UNIVERSAL_TIMESTAMP_EXTRA_FIELD_SIZE);
        izutefBuffer.writeUInt16LE(21589, 0);
        izutefBuffer.writeUInt16LE(INFO_ZIP_UNIVERSAL_TIMESTAMP_EXTRA_FIELD_SIZE - 4, 2);
        var EB_UT_FL_MTIME = 1 << 0;
        var EB_UT_FL_ATIME = 1 << 1;
        izutefBuffer.writeUInt8(EB_UT_FL_MTIME | EB_UT_FL_ATIME, 4);
        var timestamp = Math.floor(this.mtime.getTime() / 1e3);
        if (timestamp < -2147483648) timestamp = -2147483648;
        if (timestamp > 2147483647) timestamp = 2147483647;
        izutefBuffer.writeUInt32LE(timestamp, 5);
      }
      var normalCompressedSize = this.compressedSize;
      var normalUncompressedSize = this.uncompressedSize;
      var normalRelativeOffsetOfLocalHeader = this.relativeOffsetOfLocalHeader;
      var versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_UTF8;
      var zeiefBuffer = EMPTY_BUFFER;
      if (this.useZip64Format()) {
        normalCompressedSize = 4294967295;
        normalUncompressedSize = 4294967295;
        normalRelativeOffsetOfLocalHeader = 4294967295;
        versionNeededToExtract = VERSION_NEEDED_TO_EXTRACT_ZIP64;
        zeiefBuffer = bufferAlloc(ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE);
        zeiefBuffer.writeUInt16LE(1, 0);
        zeiefBuffer.writeUInt16LE(ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_SIZE - 4, 2);
        writeUInt64LE(zeiefBuffer, this.uncompressedSize, 4);
        writeUInt64LE(zeiefBuffer, this.compressedSize, 12);
        writeUInt64LE(zeiefBuffer, this.relativeOffsetOfLocalHeader, 20);
      }
      fixedSizeStuff.writeUInt32LE(33639248, 0);
      fixedSizeStuff.writeUInt16LE(VERSION_MADE_BY, 4);
      fixedSizeStuff.writeUInt16LE(versionNeededToExtract, 6);
      fixedSizeStuff.writeUInt16LE(generalPurposeBitFlag, 8);
      fixedSizeStuff.writeUInt16LE(this.getCompressionMethod(), 10);
      fixedSizeStuff.writeUInt16LE(this.lastModFileTime, 12);
      fixedSizeStuff.writeUInt16LE(this.lastModFileDate, 14);
      fixedSizeStuff.writeUInt32LE(this.crc32, 16);
      fixedSizeStuff.writeUInt32LE(normalCompressedSize, 20);
      fixedSizeStuff.writeUInt32LE(normalUncompressedSize, 24);
      fixedSizeStuff.writeUInt16LE(this.utf8FileName.length, 28);
      fixedSizeStuff.writeUInt16LE(izutefBuffer.length + zeiefBuffer.length, 30);
      fixedSizeStuff.writeUInt16LE(this.fileComment.length, 32);
      fixedSizeStuff.writeUInt16LE(0, 34);
      fixedSizeStuff.writeUInt16LE(0, 36);
      fixedSizeStuff.writeUInt32LE(this.externalFileAttributes, 38);
      fixedSizeStuff.writeUInt32LE(normalRelativeOffsetOfLocalHeader, 42);
      return Buffer.concat([
        fixedSizeStuff,
        // file name (variable size)
        this.utf8FileName,
        // extra field (variable size)
        izutefBuffer,
        zeiefBuffer,
        // file comment (variable size)
        this.fileComment
      ]);
    };
    Entry.prototype.getCompressionMethod = function() {
      var NO_COMPRESSION = 0;
      var DEFLATE_COMPRESSION = 8;
      return this.compressionLevel === 0 ? NO_COMPRESSION : DEFLATE_COMPRESSION;
    };
    var minDosDate = new Date(1980, 0, 1);
    var maxDosDate = new Date(2107, 11, 31, 23, 59, 58);
    function dateToDosDateTime(jsDate) {
      if (jsDate < minDosDate) jsDate = minDosDate;
      else if (jsDate > maxDosDate) jsDate = maxDosDate;
      var date = 0;
      date |= jsDate.getDate() & 31;
      date |= (jsDate.getMonth() + 1 & 15) << 5;
      date |= (jsDate.getFullYear() - 1980 & 127) << 9;
      var time2 = 0;
      time2 |= Math.floor(jsDate.getSeconds() / 2);
      time2 |= (jsDate.getMinutes() & 63) << 5;
      time2 |= (jsDate.getHours() & 31) << 11;
      return { date, time: time2 };
    }
    function writeUInt64LE(buffer, n, offset) {
      var high = Math.floor(n / 4294967296);
      var low = n % 4294967296;
      buffer.writeUInt32LE(low, offset);
      buffer.writeUInt32LE(high, offset + 4);
    }
    util.inherits(ByteCounter, Transform2);
    function ByteCounter(options2) {
      Transform2.call(this, options2);
      this.byteCount = 0;
    }
    ByteCounter.prototype._transform = function(chunk, encoding, cb) {
      this.byteCount += chunk.length;
      cb(null, chunk);
    };
    util.inherits(Crc32Watcher, Transform2);
    function Crc32Watcher(options2) {
      Transform2.call(this, options2);
      this.crc32 = 0;
    }
    Crc32Watcher.prototype._transform = function(chunk, encoding, cb) {
      this.crc32 = crc32.unsigned(chunk, this.crc32);
      cb(null, chunk);
    };
    var cp437 = "\0☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
    if (cp437.length !== 256) throw new Error("assertion failure");
    var reverseCp437 = null;
    function encodeCp437(string) {
      if (/^[\x20-\x7e]*$/.test(string)) {
        return bufferFrom(string, "utf-8");
      }
      if (reverseCp437 == null) {
        reverseCp437 = {};
        for (var i = 0; i < cp437.length; i++) {
          reverseCp437[cp437[i]] = i;
        }
      }
      var result = bufferAlloc(string.length);
      for (var i = 0; i < string.length; i++) {
        var b = reverseCp437[string[i]];
        if (b == null) throw new Error("character not encodable in CP437: " + JSON.stringify(string[i]));
        result[i] = b;
      }
      return result;
    }
    function bufferAlloc(size) {
      bufferAlloc = modern;
      try {
        return bufferAlloc(size);
      } catch (e) {
        bufferAlloc = legacy;
        return bufferAlloc(size);
      }
      function modern(size2) {
        return Buffer.allocUnsafe(size2);
      }
      function legacy(size2) {
        return new Buffer(size2);
      }
    }
    function bufferFrom(something, encoding) {
      bufferFrom = modern;
      try {
        return bufferFrom(something, encoding);
      } catch (e) {
        bufferFrom = legacy;
        return bufferFrom(something, encoding);
      }
      function modern(something2, encoding2) {
        return Buffer.from(something2, encoding2);
      }
      function legacy(something2, encoding2) {
        return new Buffer(something2, encoding2);
      }
    }
    function bufferIncludes(buffer, content) {
      bufferIncludes = modern;
      try {
        return bufferIncludes(buffer, content);
      } catch (e) {
        bufferIncludes = legacy;
        return bufferIncludes(buffer, content);
      }
      function modern(buffer2, content2) {
        return buffer2.includes(content2);
      }
      function legacy(buffer2, content2) {
        for (var i = 0; i <= buffer2.length - content2.length; i++) {
          for (var j = 0; ; j++) {
            if (j === content2.length) return true;
            if (buffer2[i + j] !== content2[j]) break;
          }
        }
        return false;
      }
    }
  }
});

// panel-browser:editor-renderer
var source = '"use strict";\n(() => {\n  // src/editor/color.ts\n  var clamp = (value) => Math.max(0, Math.min(1, value));\n  var wrap = (degrees) => (degrees % 360 + 360) % 360;\n  function evaluateColorCurve(points, input) {\n    const value = clamp(input);\n    if (!points.length) return value;\n    if (value <= points[0].x) return points[0].y;\n    if (value >= points.at(-1).x) return points.at(-1).y;\n    let left = 0, right = points.length - 1;\n    while (left + 1 < right) {\n      const middle = left + right >> 1;\n      if (points[middle].x <= value) left = middle;\n      else right = middle;\n    }\n    const a = points[left], b = points[right];\n    return a.y + (value - a.x) / (b.x - a.x) * (b.y - a.y);\n  }\n  function hasColorAdjustment(color2) {\n    return color2.exposure !== 0 || color2.brightness !== 0 || color2.contrast !== 1 || color2.saturation !== 1 || color2.temperature !== 0 || color2.tint !== 0 || color2.hue !== 0 || color2.curves.some((curve) => curve.points.some((point) => point.x !== point.y)) || color2.hsl.some((band) => band.hueShift !== 0 || band.saturation !== 0 || band.lightness !== 0);\n  }\n  function rgbToHsl(r, g, b) {\n    const max = Math.max(r, g, b), min = Math.min(r, g, b);\n    const lightness = (max + min) / 2, delta = max - min;\n    if (delta === 0) return [0, 0, lightness];\n    const saturation = delta / (1 - Math.abs(2 * lightness - 1));\n    const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;\n    return [wrap(hue * 60), saturation, lightness];\n  }\n  function hslToRgb(hue, saturation, lightness) {\n    const h = wrap(hue) / 60;\n    const c = (1 - Math.abs(2 * lightness - 1)) * saturation;\n    const x = c * (1 - Math.abs(h % 2 - 1));\n    const m = lightness - c / 2;\n    const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];\n    return [rgb[0] + m, rgb[1] + m, rgb[2] + m];\n  }\n  function applyColorToRgba(pixels, color2) {\n    if (pixels.length % 4) throw new Error("颜色缓冲必须包含完整 RGBA 像素");\n    if (!hasColorAdjustment(color2)) return;\n    const exposure = 2 ** color2.exposure;\n    const redGain = exposure * (1 + color2.temperature * 0.25 + color2.tint * 0.1);\n    const greenGain = exposure * (1 - color2.tint * 0.2);\n    const blueGain = exposure * (1 - color2.temperature * 0.25 + color2.tint * 0.1);\n    const curves = new Map(color2.curves.map((curve) => [curve.channel, curve.points]));\n    const tone = (input, channel) => {\n      const master = curves.get("rgb");\n      const specific = curves.get(channel);\n      const value = master ? evaluateColorCurve(master, input) : input;\n      return specific ? evaluateColorCurve(specific, value) : value;\n    };\n    for (let index = 0; index < pixels.length; index += 4) {\n      if (pixels[index + 3] === 0) continue;\n      let r = clamp(\n        (pixels[index] / 255 * redGain - 0.5) * color2.contrast + 0.5 + color2.brightness\n      );\n      let g = clamp(\n        (pixels[index + 1] / 255 * greenGain - 0.5) * color2.contrast + 0.5 + color2.brightness\n      );\n      let b = clamp(\n        (pixels[index + 2] / 255 * blueGain - 0.5) * color2.contrast + 0.5 + color2.brightness\n      );\n      if (color2.hue !== 0 || color2.saturation !== 1 || color2.hsl.length) {\n        let [h, s, l] = rgbToHsl(r, g, b);\n        let hueDelta = color2.hue, saturationDelta = 0, lightnessDelta = 0;\n        if (s > 0)\n          for (const band of color2.hsl) {\n            const distance = Math.min(wrap(h - band.hue), wrap(band.hue - h));\n            const weight = distance >= band.width / 2 ? 0 : (1 + Math.cos(2 * Math.PI * distance / band.width)) / 2;\n            hueDelta += band.hueShift * weight;\n            saturationDelta += band.saturation * weight;\n            lightnessDelta += band.lightness * weight;\n          }\n        h += hueDelta;\n        s = clamp(s * color2.saturation + saturationDelta);\n        l = clamp(l + lightnessDelta);\n        [r, g, b] = hslToRgb(h, s, l);\n      }\n      pixels[index] = Math.round(clamp(tone(r, "red")) * 255);\n      pixels[index + 1] = Math.round(clamp(tone(g, "green")) * 255);\n      pixels[index + 2] = Math.round(clamp(tone(b, "blue")) * 255);\n    }\n  }\n\n  // src/editor/visual-layout.ts\n  function fitVisualSource(source, canvas, transform2) {\n    const crop = transform2.crop;\n    const sourceX = crop.left * source.width, sourceY = crop.top * source.height;\n    const croppedWidth = source.width * (1 - crop.left - crop.right);\n    const croppedHeight = source.height * (1 - crop.top - crop.bottom);\n    if (![source.width, source.height, canvas.width, canvas.height, croppedWidth, croppedHeight].every(\n      (value) => Number.isFinite(value) && value > 0\n    ))\n      throw new Error("画面尺寸或裁切范围无效");\n    const factor = transform2.fit === "cover" ? Math.max(canvas.width / croppedWidth, canvas.height / croppedHeight) : Math.min(canvas.width / croppedWidth, canvas.height / croppedHeight);\n    const fittedWidth = transform2.fit === "stretch" ? canvas.width : croppedWidth * factor;\n    const fittedHeight = transform2.fit === "stretch" ? canvas.height : croppedHeight * factor;\n    return {\n      sourceX,\n      sourceY,\n      croppedWidth,\n      croppedHeight,\n      fittedWidth,\n      fittedHeight,\n      originalWidth: fittedWidth / (1 - crop.left - crop.right),\n      originalHeight: fittedHeight / (1 - crop.top - crop.bottom)\n    };\n  }\n\n  // src/editor/compositor.ts\n  var MAX_SIDE = 8192;\n  var MAX_ACTIVE_PIXELS = 128 * 1024 * 1024;\n  var MAX_CACHED_PIXELS = 16 * 1024 * 1024;\n  var clamp2 = (value) => Math.max(0, Math.min(1, value));\n  function dimensions(width, height) {\n    if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_SIDE))\n      throw new Error("合成画面宽高必须是 1–8192 范围内的整数");\n  }\n  function context(canvas) {\n    const value = canvas.getContext("2d");\n    if (!value) throw new Error("当前浏览器无法创建二维画面合成器");\n    return value;\n  }\n  function reset(buffer) {\n    buffer.context.reset();\n  }\n  function composite(mode) {\n    return mode === "normal" ? "source-over" : mode;\n  }\n  function directGroup(layer, width, height) {\n    const transform2 = layer.transform;\n    return layer.width === width && layer.height === height && /^#[0-9a-f]{6}00$/i.test(layer.background) && layer.blendMode === "normal" && !layer.mask && transform2.x === 0 && transform2.y === 0 && transform2.scaleX === 1 && transform2.scaleY === 1 && transform2.rotation === 0 && transform2.opacity === 1 && !transform2.flipX && !transform2.flipY && transform2.fit === "contain" && Object.values(transform2.crop).every((value) => value === 0) && !hasColorAdjustment(layer.color) && layer.color.curves.length === 0 && layer.color.hsl.length === 0 && layer.layers.every(\n      (child) => child.kind === "transition" ? (!child.from || child.from.blendMode === "normal") && (!child.to || child.to.blendMode === "normal") : child.blendMode === "normal"\n    );\n  }\n  function sourceDimensions(source, instanceId) {\n    const item = source;\n    if (typeof item.videoWidth === "number" && Number(item.readyState) < 2 || item.complete === false)\n      throw new Error(`素材画面尚未就绪：${instanceId}`);\n    const width = item.videoWidth ?? item.naturalWidth ?? item.displayWidth ?? item.width?.baseVal?.value ?? item.width;\n    const height = item.videoHeight ?? item.naturalHeight ?? item.displayHeight ?? item.height?.baseVal?.value ?? item.height;\n    if (![width, height].every(\n      (value) => typeof value === "number" && Number.isFinite(value) && value > 0\n    ))\n      throw new Error(`素材画面尺寸无效或已释放：${instanceId}`);\n    return [width, height];\n  }\n  var FrameCompositor = class {\n    free = [];\n    active = /* @__PURE__ */ new Set();\n    allocatedPixels = 0;\n    drawing = false;\n    dispose() {\n      if (this.drawing) throw new Error("正在合成画面，暂时无法释放合成器");\n      for (const item of this.free) {\n        item.canvas.width = 1;\n        item.canvas.height = 1;\n      }\n      this.free = [];\n      this.allocatedPixels = 0;\n    }\n    take(width, height) {\n      dimensions(width, height);\n      const position = this.free.findIndex(\n        (item) => item.canvas.width === width && item.canvas.height === height\n      );\n      let buffer = position < 0 ? void 0 : this.free.splice(position, 1)[0];\n      if (!buffer) {\n        while (this.free.length && this.allocatedPixels + width * height > MAX_ACTIVE_PIXELS) {\n          const evicted = this.free.pop();\n          this.allocatedPixels -= evicted.pixels;\n          evicted.canvas.width = 1;\n          evicted.canvas.height = 1;\n        }\n        if (this.allocatedPixels + width * height > MAX_ACTIVE_PIXELS || this.active.size >= 64)\n          throw new Error("画面合成缓冲超过上限，请减小画面尺寸或减少嵌套层级");\n        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });\n        buffer = { canvas, context: context(canvas), pixels: width * height };\n        this.allocatedPixels += buffer.pixels;\n      }\n      reset(buffer);\n      this.active.add(buffer);\n      return buffer;\n    }\n    release(buffer) {\n      if (!this.active.delete(buffer)) throw new Error("画面缓冲已释放");\n      if (this.free.length < 4 && this.free.reduce((sum, item) => sum + item.pixels, 0) + buffer.pixels <= MAX_CACHED_PIXELS)\n        this.free.push(buffer);\n      else {\n        this.allocatedPixels -= buffer.pixels;\n        buffer.canvas.width = 1;\n        buffer.canvas.height = 1;\n      }\n    }\n    preflight(layers, media, depth = 0) {\n      if (depth > 50 || layers.length > 2e3) throw new Error("画面层数或嵌套深度超过上限");\n      for (const layer of layers) {\n        if (layer.kind === "media") {\n          const source = media.get(layer.instanceId);\n          if (!source) throw new Error(`缺少已解码的素材画面：${layer.instanceId}`);\n          sourceDimensions(source, layer.instanceId);\n        } else if (layer.kind === "group") {\n          dimensions(layer.width, layer.height);\n          this.preflight(layer.layers, media, depth + 1);\n        } else if (layer.kind === "transition")\n          this.preflight(\n            [layer.from, layer.to].filter((item) => item !== null),\n            media,\n            depth + 1\n          );\n      }\n    }\n    draw(canvas, frame, media) {\n      if (this.drawing) throw new Error("合成器不能同时绘制两个画面");\n      dimensions(frame.width, frame.height);\n      this.preflight(frame.layers, media);\n      this.drawing = true;\n      try {\n        if (canvas.width !== frame.width) canvas.width = frame.width;\n        if (canvas.height !== frame.height) canvas.height = frame.height;\n        const target = context(canvas);\n        target.reset();\n        target.fillStyle = frame.background;\n        target.fillRect(0, 0, frame.width, frame.height);\n        this.drawLayers(target, frame.layers, frame.width, frame.height, media);\n      } finally {\n        for (const item of [...this.active]) this.release(item);\n        this.drawing = false;\n      }\n    }\n    drawLayers(target, layers, width, height, media) {\n      for (let index = 0; index < layers.length; index++) {\n        const layer = layers[index];\n        if (layer.kind === "transition") this.drawTransition(target, layer, width, height, media);\n        else if (layer.kind === "group" && directGroup(layer, width, height)) {\n          this.drawLayers(target, layer.layers, width, height, media);\n        } else {\n          let captions;\n          if (layer.kind === "text" && layer.style.layout === "caption-stack" && layer.style.animation === "none") {\n            captions = [layer.text];\n            const key = captionKey(layer);\n            while (index + 1 < layers.length) {\n              const next = layers[index + 1];\n              if (next.kind !== "text" || next.style.animation !== "none" || captionKey(next) !== key)\n                break;\n              captions.push(next.text);\n              index++;\n            }\n          }\n          const picture = this.visual(layer, width, height, media, captions);\n          try {\n            target.save();\n            target.globalCompositeOperation = composite(layer.blendMode);\n            target.drawImage(picture.canvas, 0, 0);\n            target.restore();\n          } finally {\n            this.release(picture);\n          }\n        }\n      }\n    }\n    visual(layer, width, height, media, captions) {\n      const picture = this.take(width, height);\n      let content;\n      try {\n        let source;\n        let sourceWidth, sourceHeight;\n        if (layer.kind === "media") {\n          source = media.get(layer.instanceId);\n          [sourceWidth, sourceHeight] = sourceDimensions(source, layer.instanceId);\n        } else if (layer.kind === "group") {\n          content = this.group(layer, media);\n          source = content.canvas;\n          sourceWidth = layer.width;\n          sourceHeight = layer.height;\n        } else {\n          content = this.take(width, height);\n          if (layer.kind === "text") drawText(content.context, layer, width, height, captions);\n          else drawShape(content.context, layer, width, height);\n          source = content.canvas;\n          sourceWidth = width;\n          sourceHeight = height;\n        }\n        const crop = layer.transform.crop;\n        const { sourceX, sourceY, croppedWidth, croppedHeight, fittedWidth, fittedHeight } = fitVisualSource(\n          { width: sourceWidth, height: sourceHeight },\n          { width, height },\n          layer.transform\n        );\n        const placement = (target) => {\n          target.translate(width * (0.5 + layer.transform.x), height * (0.5 + layer.transform.y));\n          target.rotate(layer.transform.rotation * Math.PI / 180);\n          target.scale(\n            layer.transform.scaleX * (layer.transform.flipX ? -1 : 1),\n            layer.transform.scaleY * (layer.transform.flipY ? -1 : 1)\n          );\n        };\n        const ctx = picture.context;\n        ctx.save();\n        placement(ctx);\n        ctx.drawImage(\n          source,\n          sourceX,\n          sourceY,\n          croppedWidth,\n          croppedHeight,\n          -fittedWidth / 2,\n          -fittedHeight / 2,\n          fittedWidth,\n          fittedHeight\n        );\n        ctx.restore();\n        if (hasColorAdjustment(layer.color)) {\n          let pixels;\n          try {\n            pixels = ctx.getImageData(0, 0, width, height);\n          } catch {\n            throw new Error(`素材画面无法读取像素进行调色：${layer.instanceId}`);\n          }\n          applyColorToRgba(pixels.data, layer.color);\n          ctx.putImageData(pixels, 0, 0);\n        }\n        if (layer.mask) {\n          const mask2 = this.take(width, height);\n          try {\n            const originalWidth = fittedWidth / (1 - crop.left - crop.right);\n            const originalHeight = fittedHeight / (1 - crop.top - crop.bottom);\n            const originX = -fittedWidth / 2 - crop.left * originalWidth;\n            const originY = -fittedHeight / 2 - crop.top * originalHeight;\n            const radius = layer.mask.feather * Math.min(\n              originalWidth * layer.transform.scaleX,\n              originalHeight * layer.transform.scaleY\n            ) / 2;\n            if (radius > 0) mask2.context.filter = `blur(${Math.min(MAX_SIDE, radius)}px)`;\n            mask2.context.save();\n            placement(mask2.context);\n            drawMask(mask2.context, layer.mask, originX, originY, originalWidth, originalHeight);\n            mask2.context.restore();\n            ctx.save();\n            ctx.globalCompositeOperation = layer.mask.inverted ? "destination-out" : "destination-in";\n            ctx.drawImage(mask2.canvas, 0, 0);\n            ctx.restore();\n          } finally {\n            this.release(mask2);\n          }\n        }\n        if (layer.transform.opacity < 1) {\n          ctx.save();\n          ctx.globalCompositeOperation = "destination-in";\n          ctx.fillStyle = `rgba(0,0,0,${clamp2(layer.transform.opacity)})`;\n          ctx.fillRect(0, 0, width, height);\n          ctx.restore();\n        }\n        return picture;\n      } catch (error) {\n        this.release(picture);\n        throw error;\n      } finally {\n        if (content) this.release(content);\n      }\n    }\n    group(layer, media) {\n      const buffer = this.take(layer.width, layer.height);\n      try {\n        buffer.context.fillStyle = layer.background;\n        buffer.context.fillRect(0, 0, layer.width, layer.height);\n        this.drawLayers(buffer.context, layer.layers, layer.width, layer.height, media);\n        return buffer;\n      } catch (error) {\n        this.release(buffer);\n        throw error;\n      }\n    }\n    drawTransition(target, transition, width, height, media) {\n      const progress2 = clamp2(transition.progress);\n      let from, to;\n      try {\n        if (transition.from) from = this.visual(transition.from, width, height, media);\n        if (transition.to) to = this.visual(transition.to, width, height, media);\n        const draw = (ctx, picture, layer, x = 0) => {\n          if (!picture || !layer) return;\n          ctx.globalCompositeOperation = composite(layer.blendMode);\n          ctx.drawImage(picture.canvas, x, 0);\n        };\n        if (transition.transitionKind === "dissolve" || transition.transitionKind === "fade-black") {\n          const a = this.take(width, height), b = this.take(width, height);\n          try {\n            a.context.drawImage(target.canvas, 0, 0);\n            b.context.drawImage(target.canvas, 0, 0);\n            draw(a.context, from, transition.from);\n            draw(b.context, to, transition.to);\n            target.save();\n            target.resetTransform();\n            target.clearRect(0, 0, width, height);\n            if (transition.transitionKind === "fade-black") {\n              target.globalCompositeOperation = "source-over";\n              target.fillStyle = "#000000";\n              target.fillRect(0, 0, width, height);\n              target.globalAlpha = Math.abs(progress2 * 2 - 1);\n              target.drawImage(progress2 < 0.5 ? a.canvas : b.canvas, 0, 0);\n            } else {\n              target.globalCompositeOperation = "lighter";\n              target.globalAlpha = 1 - progress2;\n              target.drawImage(a.canvas, 0, 0);\n              target.globalAlpha = progress2;\n              target.drawImage(b.canvas, 0, 0);\n            }\n            target.restore();\n          } finally {\n            this.release(a);\n            this.release(b);\n          }\n        } else if (transition.transitionKind === "push-left" || transition.transitionKind === "push-right") {\n          const direction = transition.transitionKind === "push-left" ? -1 : 1;\n          const a = this.take(width, height);\n          let b;\n          try {\n            if ((!transition.from || transition.from.blendMode === "normal") && (!transition.to || transition.to.blendMode === "normal")) {\n              a.context.globalCompositeOperation = "lighter";\n              if (from) a.context.drawImage(from.canvas, direction * progress2 * width, 0);\n              if (to) a.context.drawImage(to.canvas, -direction * (1 - progress2) * width, 0);\n              target.save();\n              target.globalCompositeOperation = "source-over";\n              target.drawImage(a.canvas, 0, 0);\n              target.restore();\n            } else {\n              b = this.take(width, height);\n              a.context.drawImage(target.canvas, 0, 0);\n              b.context.drawImage(target.canvas, 0, 0);\n              draw(a.context, from, transition.from, direction * progress2 * width);\n              draw(b.context, to, transition.to, -direction * (1 - progress2) * width);\n              let backdrop, first, second;\n              try {\n                backdrop = target.getImageData(0, 0, width, height);\n                first = a.context.getImageData(0, 0, width, height);\n                second = b.context.getImageData(0, 0, width, height);\n              } catch {\n                throw new Error("素材画面无法读取像素进行推移转场");\n              }\n              for (let i = 0; i < backdrop.data.length; i += 4) {\n                const originalAlpha = backdrop.data[i + 3] / 255;\n                const aAlpha = first.data[i + 3] / 255, bAlpha = second.data[i + 3] / 255;\n                const alpha = clamp2(aAlpha + bAlpha - originalAlpha);\n                for (let channel = 0; channel < 3; channel++)\n                  backdrop.data[i + channel] = alpha === 0 ? 0 : (first.data[i + channel] * aAlpha + second.data[i + channel] * bAlpha - backdrop.data[i + channel] * originalAlpha) / alpha;\n                backdrop.data[i + 3] = Math.round(alpha * 255);\n              }\n              target.putImageData(backdrop, 0, 0);\n            }\n          } finally {\n            this.release(a);\n            if (b) this.release(b);\n          }\n        } else {\n          const split = transition.transitionKind === "wipe-left" ? width * (1 - progress2) : width * progress2;\n          const incomingLeft = transition.transitionKind === "wipe-right";\n          const a = this.take(width, height), b = this.take(width, height);\n          try {\n            a.context.drawImage(target.canvas, 0, 0);\n            b.context.drawImage(target.canvas, 0, 0);\n            draw(a.context, from, transition.from);\n            draw(b.context, to, transition.to);\n            target.save();\n            target.clearRect(0, 0, width, height);\n            target.globalCompositeOperation = "lighter";\n            target.save();\n            target.beginPath();\n            target.rect(incomingLeft ? split : 0, 0, incomingLeft ? width - split : split, height);\n            target.clip();\n            target.drawImage(a.canvas, 0, 0);\n            target.restore();\n            target.save();\n            target.beginPath();\n            target.rect(incomingLeft ? 0 : split, 0, incomingLeft ? split : width - split, height);\n            target.clip();\n            target.drawImage(b.canvas, 0, 0);\n            target.restore();\n            target.restore();\n          } finally {\n            this.release(a);\n            this.release(b);\n          }\n        }\n      } finally {\n        if (from) this.release(from);\n        if (to) this.release(to);\n      }\n    }\n  };\n  function drawMask(ctx, mask2, originX, originY, width, height) {\n    ctx.translate(originX + width * (0.5 + mask2.x), originY + height * (0.5 + mask2.y));\n    ctx.rotate(mask2.rotation * Math.PI / 180);\n    const w = width * mask2.width, h = height * mask2.height;\n    ctx.fillStyle = "#ffffff";\n    ctx.beginPath();\n    if (mask2.kind === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);\n    else if (mask2.kind === "path") {\n      mask2.points.forEach((point, index) => {\n        if (index === 0) ctx.moveTo((point.x - 0.5) * w, (point.y - 0.5) * h);\n        else ctx.lineTo((point.x - 0.5) * w, (point.y - 0.5) * h);\n      });\n      ctx.closePath();\n    } else {\n      ctx.rect(-w / 2, -h / 2, w, h);\n      if (mask2.kind === "linear") {\n        const gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);\n        gradient.addColorStop(0, "#ffffff00");\n        gradient.addColorStop(1, "#ffffff");\n        ctx.fillStyle = gradient;\n      }\n    }\n    ctx.fill();\n  }\n  function captionKey(layer) {\n    return JSON.stringify([\n      layer.trackId,\n      layer.style,\n      layer.transform,\n      layer.color,\n      layer.blendMode,\n      layer.mask\n    ]);\n  }\n  function font(ctx, style) {\n    ctx.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;\n    ctx.letterSpacing = `${style.letterSpacing}px`;\n    ctx.textAlign = "left";\n    ctx.textBaseline = "alphabetic";\n  }\n  function graphemes(text2) {\n    const segmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });\n    return Array.from(segmenter.segment(text2), (segment) => ({\n      text: segment.segment,\n      index: segment.index\n    }));\n  }\n  function keywordRanges(text2, keywords) {\n    const colors = new Uint8Array(text2.length);\n    for (const [index, keyword] of (keywords ?? []).entries()) {\n      if (!keyword.text) continue;\n      for (let at = text2.indexOf(keyword.text); at >= 0; at = text2.indexOf(keyword.text, at + keyword.text.length))\n        colors.fill(index + 1, at, at + keyword.text.length);\n    }\n    const ranges = [];\n    for (let start = 0; start < colors.length; ) {\n      let end = start + 1;\n      while (end < colors.length && colors[end] === colors[start]) end++;\n      if (colors[start]) ranges.push({ start, end, color: keywords[colors[start] - 1].color });\n      start = end;\n    }\n    return ranges;\n  }\n  function wrap2(ctx, text2, maxWidth, maximum = 1e4) {\n    const result = [];\n    let line = "", start = 0;\n    for (const item of graphemes(text2)) {\n      if (item.text === "\\n" || line && ctx.measureText(line + item.text).width > maxWidth) {\n        result.push({ text: line, start });\n        if (result.length >= maximum) return result;\n        line = item.text === "\\n" ? "" : item.text;\n        start = item.index + (item.text === "\\n" ? 1 : 0);\n      } else line += item.text;\n    }\n    if (line) result.push({ text: line, start });\n    return result.slice(0, maximum);\n  }\n  function drawText(ctx, layer, width, height, captions) {\n    const style = layer.style;\n    font(ctx, style);\n    let text2 = layer.text.replace(/\\r\\n?/g, "\\n");\n    if (style.animation === "typewriter") {\n      const letters = graphemes(text2), count = Math.floor(clamp2(layer.animationProgress / 0.6) * letters.length);\n      text2 = letters.slice(0, count).map((item) => item.text).join("");\n    }\n    if (style.animation === "fade")\n      ctx.globalAlpha = clamp2(\n        Math.min(layer.animationProgress / 0.1, (1 - layer.animationProgress) / 0.1)\n      );\n    const stack = style.layout === "caption-stack";\n    const textLines = (item, maximum = 1e4) => {\n      const sourceText = item.replace(/\\r\\n?/g, "\\n");\n      const emphasis = keywordRanges(\n        style.animation === "typewriter" ? layer.text.replace(/\\r\\n?/g, "\\n") : sourceText,\n        style.keywords\n      );\n      return wrap2(ctx, sourceText, width * style.maxWidth, maximum).map((line) => ({\n        ...line,\n        emphasis\n      }));\n    };\n    const lines = stack ? (captions ?? [text2]).flatMap((item) => textLines(item, 4)).slice(0, 4) : textLines(text2);\n    if (!lines.length) return;\n    const lineHeight = style.fontSize * style.lineHeight;\n    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line.text).width));\n    const textHeight = lines.length * lineHeight;\n    const top = stack ? height / 2 - textHeight : (height - textHeight) / 2;\n    const boxWidth = Math.min(stack ? width * 0.93 : width, textWidth + style.padding * 2);\n    const boxTop = stack ? top : top - style.padding;\n    const boxHeight = textHeight + (stack ? style.padding : style.padding * 2);\n    ctx.fillStyle = style.background;\n    ctx.beginPath();\n    ctx.roundRect((width - boxWidth) / 2, boxTop, boxWidth, boxHeight, style.backgroundRadius);\n    ctx.fill();\n    ctx.shadowColor = style.shadow.color;\n    ctx.shadowBlur = style.shadow.blur;\n    ctx.shadowOffsetX = style.shadow.x;\n    ctx.shadowOffsetY = style.shadow.y;\n    ctx.fillStyle = style.color;\n    ctx.strokeStyle = style.strokeColor;\n    ctx.lineWidth = style.strokeWidth;\n    ctx.lineJoin = "round";\n    const highlights = [];\n    if (style.animation === "word-highlight") {\n      let cursor = 0;\n      layer.words.forEach((word, index) => {\n        const start = text2.indexOf(word.text, cursor);\n        if (start < 0) return;\n        cursor = start + word.text.length;\n        if (layer.activeWordIndices.includes(index))\n          highlights.push({ start, end: cursor, color: style.highlightColor });\n      });\n    }\n    const metrics = ctx.measureText("国M");\n    const ascent = metrics.actualBoundingBoxAscent || style.fontSize * 0.8;\n    const descent = metrics.actualBoundingBoxDescent || style.fontSize * 0.2;\n    lines.forEach((line, index) => {\n      const lineWidth = ctx.measureText(line.text).width;\n      const x = style.align === "left" ? (width - textWidth) / 2 : style.align === "right" ? (width + textWidth) / 2 - lineWidth : (width - lineWidth) / 2;\n      const y = stack ? top + lineHeight * (index + 1) - style.fontSize * 0.1 : top + lineHeight * index + (lineHeight - ascent - descent) / 2 + ascent;\n      if (style.strokeWidth > 0) ctx.strokeText(line.text, x, y);\n      ctx.fillText(line.text, x, y);\n      for (const highlight of [...line.emphasis, ...highlights]) {\n        const from = Math.max(0, highlight.start - line.start), to = Math.min(line.text.length, highlight.end - line.start);\n        if (to <= from) continue;\n        const left = ctx.measureText(line.text.slice(0, from)).width;\n        const right = ctx.measureText(line.text.slice(0, to)).width;\n        ctx.save();\n        ctx.beginPath();\n        ctx.rect(x + left, y - style.fontSize * 1.5, right - left, style.fontSize * 2);\n        ctx.clip();\n        ctx.shadowColor = "transparent";\n        ctx.shadowBlur = 0;\n        ctx.fillStyle = highlight.color;\n        ctx.fillText(line.text, x, y);\n        ctx.restore();\n      }\n    });\n  }\n  function drawShape(ctx, layer, width, height) {\n    ctx.beginPath();\n    if (layer.shape === "ellipse")\n      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);\n    else if (layer.shape === "line") {\n      ctx.moveTo(0, height / 2);\n      ctx.lineTo(width, height / 2);\n    } else ctx.rect(0, 0, width, height);\n    if (layer.shape !== "line") {\n      ctx.fillStyle = layer.fill;\n      ctx.fill();\n    }\n    if (layer.strokeWidth > 0) {\n      ctx.strokeStyle = layer.stroke;\n      ctx.lineWidth = layer.strokeWidth;\n      ctx.stroke();\n    }\n  }\n\n  // src/editor/time.ts\n  var TICKS_PER_SECOND = 24e4;\n  var MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);\n  var SUPPORTED_RATES = /* @__PURE__ */ new Set([\n    "24/1",\n    "25/1",\n    "30/1",\n    "48/1",\n    "50/1",\n    "60/1",\n    "24000/1001",\n    "30000/1001",\n    "60000/1001"\n  ]);\n  function assertTick(value, label2 = "时间") {\n    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)\n      throw new Error(`${label2}必须是非负安全整数刻度`);\n    return value;\n  }\n  function object(value, label2, allowed) {\n    if (!value || typeof value !== "object" || Array.isArray(value))\n      throw new Error(`${label2}必须是对象`);\n    const prototype = Object.getPrototypeOf(value);\n    if (prototype !== Object.prototype && prototype !== null)\n      throw new Error(`${label2}必须是普通对象`);\n    if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))\n      throw new Error(`${label2}包含不支持的字段`);\n    return value;\n  }\n  function validateFrameRate(value) {\n    const data = object(value, "帧率", ["numerator", "denominator"]);\n    let numerator = assertTick(data.numerator, "帧率分子");\n    let denominator = assertTick(data.denominator, "帧率分母");\n    if (!numerator || !denominator) throw new Error("帧率分子和分母必须大于零");\n    let a = numerator, b = denominator;\n    while (b) [a, b] = [b, a % b];\n    numerator /= a;\n    denominator /= a;\n    if (!SUPPORTED_RATES.has(`${numerator}/${denominator}`)) throw new Error("不支持此工程帧率");\n    return { numerator, denominator };\n  }\n  function ticksToSeconds(tick2) {\n    return assertTick(tick2) / TICKS_PER_SECOND;\n  }\n  function tickFromBigInt(value) {\n    if (value < 0n || value > MAX_TICK) throw new Error("时间超过安全整数刻度范围");\n    return Number(value);\n  }\n  function validateTimeMap(value, duration, sourceDuration) {\n    assertTick(duration, "片段时长");\n    assertTick(sourceDuration, "素材时长");\n    if (!duration) throw new Error("片段时长必须大于零");\n    const data = object(value, "时间映射", ["points"]);\n    if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 1e5)\n      throw new Error("时间映射需要 2 至 100000 个节点");\n    if (Object.getPrototypeOf(data.points) !== Array.prototype || Reflect.ownKeys(data.points).length !== data.points.length + 1)\n      throw new Error("时间映射节点必须是连续的普通数组");\n    for (let index = 0; index < data.points.length; index++)\n      if (!Object.hasOwn(data.points, index)) throw new Error("时间映射节点不能留空");\n    let previous = -1;\n    const points = data.points.map((raw) => {\n      const point = object(raw, "时间映射节点", ["time", "source"]);\n      const time = assertTick(point.time, "局部时间");\n      const source = assertTick(point.source, "源时间");\n      if (time <= previous || time > duration) throw new Error("时间映射的局部时间必须严格递增");\n      if (source > sourceDuration) throw new Error("时间映射超出素材时长");\n      previous = time;\n      return { time, source };\n    });\n    if (points[0].time !== 0 || points.at(-1).time !== duration)\n      throw new Error("时间映射必须覆盖片段的完整时长");\n    return { points };\n  }\n  function interpolateSource(a, b, time) {\n    const width = BigInt(b.time - a.time);\n    const elapsed = BigInt(time - a.time);\n    const numerator = BigInt(a.source) * (width - elapsed) + BigInt(b.source) * elapsed;\n    return tickFromBigInt((2n * numerator + width) / (2n * width));\n  }\n  function sourceTimeAt(map, time) {\n    assertTick(time, "局部时间");\n    if (map.points.length < 2) throw new Error("时间映射缺少节点");\n    if (time <= map.points[0].time) return map.points[0].source;\n    if (time >= map.points.at(-1).time) return map.points.at(-1).source;\n    let left = 0, right = map.points.length - 1;\n    while (left + 1 < right) {\n      const middle = left + Math.floor((right - left) / 2);\n      if (map.points[middle].time <= time) left = middle;\n      else right = middle;\n    }\n    return interpolateSource(map.points[left], map.points[right], time);\n  }\n\n  // src/editor/animation.ts\n  function finite(value, label2) {\n    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label2}必须是有限数`);\n    return value;\n  }\n  function object2(value, allowed, label2) {\n    if (!value || typeof value !== "object" || Array.isArray(value))\n      throw new Error(`${label2}必须是对象`);\n    const prototype = Object.getPrototypeOf(value);\n    if (prototype !== Object.prototype && prototype !== null)\n      throw new Error(`${label2}必须是普通对象`);\n    if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))\n      throw new Error(`${label2}包含不支持的字段`);\n    return value;\n  }\n  function validateEasing(value) {\n    if (typeof value === "string" && ["linear", "hold", "ease-in", "ease-out", "ease-in-out"].includes(value))\n      return value;\n    const data = object2(value, ["type", "x1", "y1", "x2", "y2"], "关键帧缓动");\n    if (data.type !== "cubic-bezier") throw new Error("未知关键帧缓动");\n    const result = {\n      type: "cubic-bezier",\n      x1: finite(data.x1, "贝塞尔 x1"),\n      y1: finite(data.y1, "贝塞尔 y1"),\n      x2: finite(data.x2, "贝塞尔 x2"),\n      y2: finite(data.y2, "贝塞尔 y2")\n    };\n    if (result.x1 < 0 || result.x1 > 1 || result.x2 < 0 || result.x2 > 1 || result.y1 < -4 || result.y1 > 4 || result.y2 < -4 || result.y2 > 4)\n      throw new Error("贝塞尔横轴控制点须在 0–1，纵轴控制点须在 -4–4");\n    return result;\n  }\n  function validateKeyframes(value, duration) {\n    if (duration !== void 0) assertTick(duration, "动画时长");\n    if (!Array.isArray(value) || !value.length || value.length > 1e5)\n      throw new Error("动画需要 1 至 100000 个关键帧");\n    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)\n      throw new Error("关键帧必须是连续的普通数组");\n    for (let index = 0; index < value.length; index++)\n      if (!Object.hasOwn(value, index)) throw new Error("关键帧不能留空");\n    let previous = -1;\n    return value.map((raw) => {\n      const data = object2(raw, ["time", "value", "easing"], "关键帧");\n      const time = assertTick(data.time, "关键帧时间");\n      if (time <= previous || duration !== void 0 && time > duration)\n        throw new Error("关键帧时间必须严格递增且位于动画时长内");\n      previous = time;\n      return {\n        time,\n        value: finite(data.value, "关键帧数值"),\n        ...data.easing === void 0 ? {} : { easing: validateEasing(data.easing) }\n      };\n    });\n  }\n  function validateAnimatedNumber(value, duration) {\n    if (duration !== void 0) assertTick(duration, "动画时长");\n    if (typeof value === "number") return finite(value, "动画数值");\n    const data = object2(value, ["keyframes"], "动画数值");\n    return { keyframes: validateKeyframes(data.keyframes, duration) };\n  }\n  function cubicFor(easing) {\n    if (typeof easing === "object") return easing;\n    if (easing === "ease-in") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 1, y2: 1 };\n    if (easing === "ease-out") return { type: "cubic-bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 };\n    if (easing === "ease-in-out") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };\n    return void 0;\n  }\n  function coordinate(t, p1, p2) {\n    const rest = 1 - t;\n    return 3 * rest * rest * t * p1 + 3 * rest * t * t * p2 + t * t * t;\n  }\n  function parameterAtX(cubic, x) {\n    if (x <= 0) return 0;\n    if (x >= 1) return 1;\n    let left = 0, right = 1;\n    for (let i = 0; i < 56; i++) {\n      const middle = (left + right) / 2;\n      if (coordinate(middle, cubic.x1, cubic.x2) < x) left = middle;\n      else right = middle;\n    }\n    return (left + right) / 2;\n  }\n  function progress(easing, x) {\n    if (x <= 0) return 0;\n    if (x >= 1) return 1;\n    if (easing === "hold") return 0;\n    const cubic = cubicFor(easing);\n    return cubic ? coordinate(parameterAtX(cubic, x), cubic.y1, cubic.y2) : x;\n  }\n  function preceding(keys, time) {\n    let left = 0, right = keys.length - 1;\n    while (left + 1 < right) {\n      const middle = left + Math.floor((right - left) / 2);\n      if (keys[middle].time <= time) left = middle;\n      else right = middle;\n    }\n    return left;\n  }\n  function evaluateAnimatedNumber(value, time) {\n    assertTick(time, "动画时间");\n    if (typeof value === "number") return value;\n    const keys = value.keyframes;\n    if (!keys.length) throw new Error("动画缺少关键帧");\n    if (time <= keys[0].time) return keys[0].value;\n    if (time >= keys.at(-1).time) return keys.at(-1).value;\n    const index = preceding(keys, time), left = keys[index], right = keys[index + 1];\n    if (time === left.time || left.value === right.value) return left.value;\n    const amount = progress(left.easing ?? "linear", (time - left.time) / (right.time - left.time));\n    return left.value * (1 - amount) + right.value * amount;\n  }\n\n  // src/editor/export-settings.ts\n  var VIDEO_ENCODERS = {\n    h264: "libx264",\n    hevc: "libx265",\n    vp9: "libvpx-vp9",\n    prores: "prores_ks"\n  };\n  var AUDIO_ENCODERS = { aac: "aac", opus: "libopus", pcm: "pcm_s16le" };\n  var PROFILE_KEYS = [\n    "id",\n    "name",\n    "width",\n    "height",\n    "frameRate",\n    "container",\n    "videoCodec",\n    "audioCodec",\n    "quality",\n    "audioBitrate",\n    "sampleRate",\n    "includeCaptions"\n  ];\n  function object3(value, keys, label2) {\n    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key)))\n      throw new Error(`${label2}格式无效或包含未知字段`);\n    return value;\n  }\n  function integer(value, min, max, label2) {\n    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)\n      throw new Error(`${label2}必须是 ${min}–${max} 范围内的整数`);\n    return Number(value);\n  }\n  function label(value, max, name) {\n    if (typeof value !== "string" || !value.trim() || value.length > max || /[\\x00-\\x1f\\x7f]/.test(value))\n      throw new Error(`${name}无效`);\n    return value;\n  }\n  function rate(value) {\n    const data = object3(value, ["numerator", "denominator"], "导出帧率");\n    return validateFrameRate(data);\n  }\n  function validateExportProfile(value) {\n    const data = object3(value, PROFILE_KEYS, "导出配置");\n    const id2 = label(data.id, 128, "导出配置 ID");\n    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id2)) throw new Error("导出配置 ID 无效");\n    const name = label(data.name, 200, "导出配置名称");\n    const width = integer(data.width, 16, 8192, "导出宽度");\n    const height = integer(data.height, 16, 8192, "导出高度");\n    if (width % 2 || height % 2) throw new Error("导出画面宽高必须是偶数");\n    const frameRate = rate(data.frameRate);\n    if (!["mp4", "mov", "webm"].includes(data.container)) throw new Error("不支持此导出容器");\n    if (!Object.hasOwn(VIDEO_ENCODERS, data.videoCodec)) throw new Error("不支持此视频编码");\n    if (!Object.hasOwn(AUDIO_ENCODERS, data.audioCodec)) throw new Error("不支持此音频编码");\n    const container = data.container;\n    const videoCodec = data.videoCodec;\n    const audioCodec = data.audioCodec;\n    const compatible = container === "webm" ? videoCodec === "vp9" && audioCodec === "opus" : container === "mp4" ? ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" : ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" || videoCodec === "prores" && audioCodec === "pcm";\n    if (!compatible) throw new Error("所选容器与音视频编码不兼容");\n    const rawQuality = object3(data.quality, ["mode", "value", "bitsPerSecond"], "导出质量");\n    let quality;\n    if (rawQuality.mode === "quality") {\n      if (Object.hasOwn(rawQuality, "bitsPerSecond")) throw new Error("质量模式不能同时指定码率");\n      quality = { mode: "quality", value: integer(rawQuality.value, 0, 100, "导出质量") };\n    } else if (rawQuality.mode === "bitrate") {\n      if (Object.hasOwn(rawQuality, "value")) throw new Error("码率模式不能同时指定质量");\n      if (videoCodec === "prores")\n        throw new Error("ProRes 请使用质量模式，编码器不支持此目标码率控制");\n      quality = {\n        mode: "bitrate",\n        bitsPerSecond: integer(rawQuality.bitsPerSecond, 1e5, 5e8, "视频目标码率")\n      };\n    } else throw new Error("导出质量模式无效");\n    const audioBitrate = audioCodec === "pcm" ? integer(data.audioBitrate, 1536e3, 1536e3, "PCM 音频码率") : integer(data.audioBitrate, 32e3, audioCodec === "opus" ? 51e4 : 512e3, "音频目标码率");\n    if (data.sampleRate !== 48e3) throw new Error("导出音频采样率必须为 48000 Hz");\n    if (typeof data.includeCaptions !== "boolean") throw new Error("请明确是否导出字幕");\n    return {\n      id: id2,\n      name,\n      width,\n      height,\n      frameRate,\n      container,\n      videoCodec,\n      audioCodec,\n      quality,\n      audioBitrate,\n      sampleRate: 48e3,\n      includeCaptions: data.includeCaptions\n    };\n  }\n\n  // src/editor/validation.ts\n  var MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;\n  var MAX_DOCUMENT_NODES = 1e6;\n  var MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;\n  var controls = /[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/;\n  function copyData(value) {\n    let nodes = 0, characters = 0;\n    const ancestors = /* @__PURE__ */ new Set();\n    function visit(item, depth) {\n      if (++nodes > MAX_DOCUMENT_NODES || depth > 64) throw new Error("工程结构超过容量限制");\n      if (item === null || typeof item === "boolean") return item;\n      if (typeof item === "number") {\n        if (!Number.isFinite(item)) throw new Error("工程不能包含非有限数字");\n        return item;\n      }\n      if (typeof item === "string") {\n        characters += item.length;\n        if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");\n        return item;\n      }\n      if (!item || typeof item !== "object") throw new Error("工程必须只包含 JSON 数据");\n      if (ancestors.has(item)) throw new Error("工程 JSON 数据不能循环引用");\n      const array = Array.isArray(item);\n      const prototype = Object.getPrototypeOf(item);\n      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)\n        throw new Error("工程数据必须是普通对象或数组");\n      ancestors.add(item);\n      try {\n        const result = array ? [] : {};\n        const keys = Reflect.ownKeys(item);\n        if (array && keys.length !== item.length + 1)\n          throw new Error("工程数组不能有空洞或额外属性");\n        for (const key of keys) {\n          if (array && key === "length") continue;\n          if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))\n            throw new Error("工程包含不安全的数据键");\n          characters += key.length;\n          if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");\n          if (array && !/^(0|[1-9]\\d*)$/.test(key)) throw new Error("工程数组包含额外属性");\n          const descriptor = Object.getOwnPropertyDescriptor(item, key);\n          if (!descriptor.enumerable || !("value" in descriptor))\n            throw new Error("工程不接受隐藏属性或访问器");\n          result[key] = visit(descriptor.value, depth + 1);\n        }\n        return result;\n      } finally {\n        ancestors.delete(item);\n      }\n    }\n    return visit(value, 0);\n  }\n  function object4(value, allowed, label2) {\n    if (!value || typeof value !== "object" || Array.isArray(value))\n      throw new Error(`${label2}必须是对象`);\n    const data = value;\n    for (const key of Object.keys(data))\n      if (!allowed.includes(key)) throw new Error(`${label2}包含未知字段：${key}`);\n    return data;\n  }\n  function list(value, limit, label2, minimum = 0) {\n    if (!Array.isArray(value) || value.length < minimum || value.length > limit)\n      throw new Error(`${label2}需要 ${minimum} 至 ${limit} 项`);\n    return value;\n  }\n  function number(value, min, max, label2) {\n    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)\n      throw new Error(`${label2}必须在 ${min} 至 ${max} 之间`);\n    return value;\n  }\n  function integer2(value, min, max, label2) {\n    const result = number(value, min, max, label2);\n    if (!Number.isSafeInteger(result)) throw new Error(`${label2}必须是安全整数`);\n    return result;\n  }\n  function tick(value, label2, positive = false) {\n    return integer2(value, positive ? 1 : 0, MAX_EDITOR_TICK, label2);\n  }\n  function text(value, max, label2, empty = false, multiline = false) {\n    if (typeof value !== "string" || value.length > max || !empty && !value.trim() || controls.test(value) || !multiline && /[\\n\\r\\t]/.test(value))\n      throw new Error(`${label2}文字无效或超过 ${max} 字符`);\n    return value;\n  }\n  function id(value, label2) {\n    const result = text(value, 128, label2);\n    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result)) throw new Error(`${label2}无效`);\n    return result;\n  }\n  function bool(value, label2) {\n    if (typeof value !== "boolean") throw new Error(`${label2}必须是布尔值`);\n    return value;\n  }\n  function choice(value, allowed, label2) {\n    if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label2}无效`);\n    return value;\n  }\n  function color(value, label2) {\n    if (typeof value !== "string" || !(value === "transparent" || /^#(?:[\\da-f]{3,4}|[\\da-f]{6}|[\\da-f]{8})$/i.test(value)))\n      throw new Error(`${label2}须为十六进制颜色或 transparent`);\n    return value;\n  }\n  function unique(items, label2) {\n    const result = /* @__PURE__ */ new Map();\n    for (const item of items) {\n      if (result.has(item.id)) throw new Error(`${label2} ID 重复：${item.id}`);\n      result.set(item.id, item);\n    }\n    return result;\n  }\n  function dataObject(value, label2) {\n    if (!value || typeof value !== "object" || Array.isArray(value))\n      throw new Error(`${label2}必须是对象`);\n    return value;\n  }\n  function animated(value, duration, min, max, label2) {\n    if (typeof value === "number") return number(value, min, max, label2);\n    const data = object4(value, ["keyframes"], label2);\n    for (const raw of list(data.keyframes, 1e4, `${label2}关键帧`, 1)) {\n      const frame = object4(raw, ["time", "value", "easing"], "关键帧");\n      number(frame.value, min, max, label2);\n      if (typeof frame.easing === "object")\n        object4(frame.easing, ["type", "x1", "y1", "x2", "y2"], "缓动曲线");\n    }\n    return validateAnimatedNumber(data, duration);\n  }\n  function timeMap(value, duration, sourceDuration) {\n    const data = object4(value, ["points"], "时间映射");\n    for (const point of list(data.points, 1e4, "时间映射节点", 2))\n      object4(point, ["time", "source"], "时间映射节点");\n    return validateTimeMap(data, duration, sourceDuration);\n  }\n  function assertNoEmptyHold(map, sourceDuration, label2) {\n    if (map.points.some(\n      (point, index) => index > 0 && point.source === sourceDuration && map.points[index - 1].source === sourceDuration\n    ))\n      throw new Error(`${label2}不能在素材结束边界定格`);\n  }\n  function transform(value, duration) {\n    const data = object4(\n      value,\n      ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY", "fit", "crop"],\n      "构图"\n    );\n    const crop = object4(data.crop, ["left", "top", "right", "bottom"], "裁切");\n    const bounds = {\n      left: number(crop.left, 0, 1, "左裁切"),\n      top: number(crop.top, 0, 1, "上裁切"),\n      right: number(crop.right, 0, 1, "右裁切"),\n      bottom: number(crop.bottom, 0, 1, "下裁切")\n    };\n    if (bounds.left + bounds.right >= 1 || bounds.top + bounds.bottom >= 1)\n      throw new Error("裁切后必须保留有效画面");\n    return {\n      x: animated(data.x, duration, -10, 10, "水平位置"),\n      y: animated(data.y, duration, -10, 10, "垂直位置"),\n      scaleX: animated(data.scaleX, duration, 0, 100, "水平缩放"),\n      scaleY: animated(data.scaleY, duration, 0, 100, "垂直缩放"),\n      rotation: animated(data.rotation, duration, -36e4, 36e4, "旋转"),\n      opacity: animated(data.opacity, duration, 0, 1, "不透明度"),\n      flipX: bool(data.flipX, "水平翻转"),\n      flipY: bool(data.flipY, "垂直翻转"),\n      fit: choice(data.fit, ["contain", "cover", "stretch"], "画面适配"),\n      crop: bounds\n    };\n  }\n  function adjustment(value, duration) {\n    const data = object4(\n      value,\n      [\n        "exposure",\n        "brightness",\n        "contrast",\n        "saturation",\n        "temperature",\n        "tint",\n        "hue",\n        "curves",\n        "hsl"\n      ],\n      "调色"\n    );\n    const channels = /* @__PURE__ */ new Set();\n    const curves = list(data.curves, 4, "调色曲线").map((raw) => {\n      const curve = object4(raw, ["channel", "points"], "调色曲线");\n      const channel = choice(curve.channel, ["rgb", "red", "green", "blue"], "曲线通道");\n      if (channels.has(channel)) throw new Error("调色曲线通道重复");\n      channels.add(channel);\n      let last = -1;\n      const points = list(curve.points, 256, "曲线节点", 2).map((entry) => {\n        const point = object4(entry, ["x", "y"], "曲线节点");\n        const x = number(point.x, 0, 1, "曲线输入"), y = number(point.y, 0, 1, "曲线输出");\n        if (x <= last) throw new Error("调色曲线输入必须严格递增");\n        last = x;\n        return { x, y };\n      });\n      if (points[0].x !== 0 || points.at(-1).x !== 1) throw new Error("调色曲线必须覆盖 0 至 1");\n      return { channel, points };\n    });\n    const hsl = list(data.hsl, 24, "HSL 调整").map((raw) => {\n      const band = object4(raw, ["hue", "width", "hueShift", "saturation", "lightness"], "HSL 调整");\n      return {\n        hue: number(band.hue, 0, 360, "HSL 色相"),\n        width: number(band.width, 1e-3, 360, "HSL 范围"),\n        hueShift: number(band.hueShift, -180, 180, "HSL 色相偏移"),\n        saturation: number(band.saturation, -1, 1, "HSL 饱和度"),\n        lightness: number(band.lightness, -1, 1, "HSL 明度")\n      };\n    });\n    return {\n      exposure: animated(data.exposure, duration, -10, 10, "曝光"),\n      brightness: animated(data.brightness, duration, -1, 1, "亮度"),\n      contrast: animated(data.contrast, duration, 0, 4, "对比度"),\n      saturation: animated(data.saturation, duration, 0, 4, "饱和度"),\n      temperature: animated(data.temperature, duration, -1, 1, "色温"),\n      tint: animated(data.tint, duration, -1, 1, "色调"),\n      hue: animated(data.hue, duration, -360, 360, "色相"),\n      curves,\n      hsl\n    };\n  }\n  function mask(value) {\n    const data = object4(\n      value,\n      ["kind", "x", "y", "width", "height", "rotation", "feather", "inverted", "points"],\n      "蒙版"\n    );\n    const kind = choice(data.kind, ["rectangle", "ellipse", "linear", "path"], "蒙版类型");\n    let points;\n    if (kind === "path") {\n      points = list(data.points, 256, "蒙版顶点", 3).map((raw) => {\n        const point = object4(raw, ["x", "y"], "蒙版顶点");\n        return { x: number(point.x, 0, 1, "蒙版顶点 x"), y: number(point.y, 0, 1, "蒙版顶点 y") };\n      });\n      if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3)\n        throw new Error("路径蒙版至少需要三个不同顶点");\n    } else if (data.points !== void 0) throw new Error("只有路径蒙版可以保存顶点");\n    return {\n      kind,\n      x: number(data.x, -2, 2, "蒙版 x"),\n      y: number(data.y, -2, 2, "蒙版 y"),\n      width: number(data.width, 1e-3, 4, "蒙版宽度"),\n      height: number(data.height, 1e-3, 4, "蒙版高度"),\n      rotation: number(data.rotation, -36e4, 36e4, "蒙版旋转"),\n      feather: number(data.feather, 0, 1, "蒙版羽化"),\n      inverted: bool(data.inverted, "蒙版反转"),\n      ...points ? { points } : {}\n    };\n  }\n  function visual(data, duration) {\n    return {\n      transform: transform(data.transform, duration),\n      color: adjustment(data.color, duration),\n      blendMode: choice(\n        data.blendMode,\n        ["normal", "multiply", "screen", "overlay", "darken", "lighten"],\n        "混合模式"\n      ),\n      ...data.mask === void 0 ? {} : { mask: mask(data.mask) }\n    };\n  }\n  function audio(value, duration) {\n    const data = object4(\n      value,\n      ["volume", "pan", "fadeIn", "fadeOut", "pitchSemitones", "preservePitch", "ducking"],\n      "音频混音"\n    );\n    let ducking;\n    if (data.ducking !== void 0) {\n      const sidechain = object4(\n        data.ducking,\n        ["sidechainTrackIds", "thresholdDb", "attenuationDb", "attack", "release"],\n        "自动压低背景声"\n      );\n      const sidechainTrackIds = list(sidechain.sidechainTrackIds, 64, "参考音轨", 1).map(\n        (value2) => id(value2, "参考音轨 ID")\n      );\n      if (new Set(sidechainTrackIds).size !== sidechainTrackIds.length)\n        throw new Error("参考音轨重复");\n      ducking = {\n        sidechainTrackIds,\n        thresholdDb: number(sidechain.thresholdDb, -96, 0, "压低触发电平"),\n        attenuationDb: number(sidechain.attenuationDb, 0, 60, "压低分贝"),\n        attack: integer2(sidechain.attack, 0, TICKS_PER_SECOND * 10, "压低启动时间"),\n        release: integer2(sidechain.release, 0, TICKS_PER_SECOND * 30, "压低恢复时间")\n      };\n    }\n    return {\n      volume: animated(data.volume, duration, 0, 4, "音量"),\n      pan: animated(data.pan, duration, -1, 1, "声像"),\n      fadeIn: integer2(data.fadeIn, 0, duration, "声音淡入"),\n      fadeOut: integer2(data.fadeOut, 0, duration, "声音淡出"),\n      pitchSemitones: number(data.pitchSemitones, -24, 24, "音高"),\n      preservePitch: bool(data.preservePitch, "保持音高"),\n      ...ducking ? { ducking } : {}\n    };\n  }\n  function textStyle(value) {\n    const data = object4(\n      value,\n      [\n        "layout",\n        "fontFamily",\n        "fontSize",\n        "fontWeight",\n        "italic",\n        "color",\n        "strokeColor",\n        "strokeWidth",\n        "background",\n        "backgroundRadius",\n        "padding",\n        "align",\n        "lineHeight",\n        "letterSpacing",\n        "maxWidth",\n        "highlightColor",\n        "keywords",\n        "shadow",\n        "animation"\n      ],\n      "文字样式"\n    );\n    const shadow = object4(data.shadow, ["color", "blur", "x", "y"], "文字阴影");\n    return {\n      layout: choice(data.layout, ["box", "caption-stack"], "文字布局"),\n      fontFamily: text(data.fontFamily, 200, "字体"),\n      fontSize: number(data.fontSize, 1, 2048, "字号"),\n      fontWeight: integer2(data.fontWeight, 1, 1e3, "字重"),\n      italic: bool(data.italic, "斜体"),\n      color: color(data.color, "文字颜色"),\n      strokeColor: color(data.strokeColor, "文字描边颜色"),\n      strokeWidth: number(data.strokeWidth, 0, 100, "文字描边宽度"),\n      background: color(data.background, "文字背景"),\n      backgroundRadius: number(data.backgroundRadius, 0, 512, "文字背景圆角"),\n      padding: number(data.padding, 0, 512, "文字背景内边距"),\n      align: choice(data.align, ["left", "center", "right"], "文字对齐"),\n      lineHeight: number(data.lineHeight, 0.5, 5, "文字行高"),\n      letterSpacing: number(data.letterSpacing, -100, 100, "字间距"),\n      maxWidth: number(data.maxWidth, 0.01, 1, "文字最大宽度比例"),\n      highlightColor: color(data.highlightColor, "文字高亮颜色"),\n      ...data.keywords === void 0 ? {} : {\n        keywords: list(data.keywords, 32, "关键词强调").map((value2) => {\n          const keyword = object4(value2, ["text", "color"], "关键词强调");\n          return {\n            text: text(keyword.text, 200, "关键词"),\n            color: color(keyword.color, "关键词颜色")\n          };\n        })\n      },\n      shadow: {\n        color: color(shadow.color, "文字阴影颜色"),\n        blur: number(shadow.blur, 0, 256, "文字阴影模糊"),\n        x: number(shadow.x, -2048, 2048, "文字阴影水平偏移"),\n        y: number(shadow.y, -2048, 2048, "文字阴影垂直偏移")\n      },\n      animation: choice(data.animation, ["none", "fade", "typewriter", "word-highlight"], "文字动画")\n    };\n  }\n  function asset(value) {\n    const data = object4(\n      value,\n      ["id", "name", "kind", "duration", "width", "height", "resourceId", "fingerprint", "metadata"],\n      "素材"\n    );\n    const kind = choice(data.kind, ["video", "audio", "image", "demo"], "素材类型");\n    let resourceId;\n    if (data.resourceId !== void 0) {\n      resourceId = text(data.resourceId, 256, "素材资源 ID");\n      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(resourceId))\n        throw new Error("素材资源 ID 无效");\n    }\n    if (data.fingerprint !== void 0 && (typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)))\n      throw new Error("素材指纹须为 SHA-256");\n    return {\n      id: id(data.id, "素材 ID"),\n      name: text(data.name, 256, "素材名称"),\n      kind,\n      duration: tick(data.duration, "素材时长", kind !== "image"),\n      ...data.width === void 0 ? {} : { width: integer2(data.width, 1, 32768, "素材宽度") },\n      ...data.height === void 0 ? {} : { height: integer2(data.height, 1, 32768, "素材高度") },\n      ...resourceId === void 0 ? {} : { resourceId },\n      ...data.fingerprint === void 0 ? {} : { fingerprint: data.fingerprint },\n      ...data.metadata === void 0 ? {} : { metadata: dataObject(data.metadata, "素材元数据") }\n    };\n  }\n  function track(value) {\n    const data = object4(\n      value,\n      ["id", "name", "kind", "locked", "hidden", "muted", "volume", "pan"],\n      "轨道"\n    );\n    return {\n      id: id(data.id, "轨道 ID"),\n      name: text(data.name, 200, "轨道名称"),\n      kind: choice(data.kind, ["video", "audio", "text"], "轨道类型"),\n      locked: bool(data.locked, "锁定轨道"),\n      hidden: bool(data.hidden, "隐藏轨道"),\n      muted: bool(data.muted, "静音轨道"),\n      volume: number(data.volume, 0, 4, "轨道音量"),\n      pan: number(data.pan, -1, 1, "轨道声像")\n    };\n  }\n  var clipKeys = [\n    "id",\n    "kind",\n    "trackId",\n    "start",\n    "duration",\n    "label",\n    "groupId",\n    "linkGroupId",\n    "transform",\n    "color",\n    "blendMode",\n    "mask"\n  ];\n  function clip(value, assets) {\n    const raw = object4(\n      value,\n      [\n        ...clipKeys,\n        "assetId",\n        "timeMap",\n        "audio",\n        "role",\n        "text",\n        "style",\n        "words",\n        "sourceBinding",\n        "translation",\n        "shape",\n        "fill",\n        "stroke",\n        "strokeWidth",\n        "sequenceId",\n        "angles",\n        "switches",\n        "audioAngleId"\n      ],\n      "片段"\n    );\n    const kind = choice(raw.kind, ["media", "text", "shape", "sequence", "multicam"], "片段类型");\n    const keys = {\n      media: ["assetId", "timeMap", "audio"],\n      text: ["role", "text", "style", "words", "sourceBinding", "translation"],\n      shape: ["shape", "fill", "stroke", "strokeWidth"],\n      sequence: ["sequenceId", "timeMap", "audio"],\n      multicam: ["timeMap", "angles", "switches", "audioAngleId", "audio"]\n    };\n    const data = object4(raw, [...clipKeys, ...keys[kind]], "片段");\n    const start = tick(data.start, "片段起点"), duration = tick(data.duration, "片段时长", true);\n    if (start + duration > MAX_EDITOR_TICK) throw new Error("片段末端超过 24 小时");\n    const base = {\n      id: id(data.id, "片段 ID"),\n      trackId: id(data.trackId, "片段轨道 ID"),\n      start,\n      duration,\n      label: text(data.label, 256, "片段名称", true),\n      ...data.groupId === void 0 ? {} : { groupId: id(data.groupId, "分组 ID") },\n      ...data.linkGroupId === void 0 ? {} : { linkGroupId: id(data.linkGroupId, "关联组 ID") },\n      ...visual(data, duration)\n    };\n    if (kind === "media") {\n      const assetId = id(data.assetId, "片段素材 ID"), source = assets.get(assetId);\n      if (!source) throw new Error(`片段引用不存在的素材：${assetId}`);\n      const mapping = timeMap(data.timeMap, duration, source.duration);\n      if (source.kind !== "image") assertNoEmptyHold(mapping, source.duration, "媒体片段");\n      return { ...base, kind, assetId, timeMap: mapping, audio: audio(data.audio, duration) };\n    }\n    if (kind === "sequence")\n      return {\n        ...base,\n        kind,\n        sequenceId: id(data.sequenceId, "嵌套序列 ID"),\n        timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),\n        audio: audio(data.audio, duration)\n      };\n    if (kind === "shape")\n      return {\n        ...base,\n        kind,\n        shape: choice(data.shape, ["rectangle", "ellipse", "line"], "图形类型"),\n        fill: color(data.fill, "图形填充"),\n        stroke: color(data.stroke, "图形描边"),\n        strokeWidth: number(data.strokeWidth, 0, 1024, "图形描边宽度")\n      };\n    if (kind === "multicam") {\n      const angles = list(data.angles, 32, "多机位", 2).map((raw2) => {\n        const angle = object4(raw2, ["id", "name", "assetId", "offset"], "机位");\n        const assetId = id(angle.assetId, "机位素材 ID");\n        if (assets.get(assetId)?.kind !== "video") throw new Error("多机位须引用有效的视频素材");\n        return {\n          id: id(angle.id, "机位 ID"),\n          name: text(angle.name, 200, "机位名称"),\n          assetId,\n          offset: integer2(angle.offset, -MAX_EDITOR_TICK, MAX_EDITOR_TICK, "机位同步偏移")\n        };\n      });\n      const anglesById = unique(angles, "机位");\n      let previous = -1;\n      const switches = list(data.switches, 1e4, "机位切换", 1).map((raw2) => {\n        const change = object4(raw2, ["time", "angleId"], "机位切换");\n        const time = integer2(change.time, 0, duration - 1, "机位切换时间");\n        if (time <= previous) throw new Error("机位切换时间必须严格递增");\n        previous = time;\n        const angleId = id(change.angleId, "切换机位 ID");\n        if (!anglesById.has(angleId)) throw new Error("切换引用不存在的机位");\n        return { time, angleId };\n      });\n      if (switches[0].time !== 0) throw new Error("多机位须从零时刻指定画面");\n      const audioAngleId = id(data.audioAngleId, "主声音机位 ID");\n      if (!anglesById.has(audioAngleId)) throw new Error("主声音引用不存在的机位");\n      return {\n        ...base,\n        kind,\n        timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),\n        angles,\n        switches,\n        audioAngleId,\n        audio: audio(data.audio, duration)\n      };\n    }\n    let previousStart = -1, previousEnd = -1;\n    const words = list(data.words, 1e4, "逐字字幕").map((raw2) => {\n      const word = object4(raw2, ["text", "start", "end"], "字幕词");\n      const start2 = integer2(word.start, 0, duration - 1, "字幕词入点");\n      const end = integer2(word.end, start2 + 1, duration, "字幕词出点");\n      if (start2 < previousStart || end < previousEnd) throw new Error("字幕词时间必须按顺序排列");\n      previousStart = start2;\n      previousEnd = end;\n      return { text: text(word.text, 1e3, "字幕词"), start: start2, end };\n    });\n    let sourceBinding;\n    if (data.sourceBinding !== void 0) {\n      const binding = object4(\n        data.sourceBinding,\n        ["clipId", "sourceStart", "sourceEnd", "provenance"],\n        "字幕来源"\n      );\n      const sourceStart = tick(binding.sourceStart, "字幕源入点"), sourceEnd = tick(binding.sourceEnd, "字幕源出点");\n      if (sourceEnd <= sourceStart) throw new Error("字幕来源须有有效时长");\n      sourceBinding = { clipId: id(binding.clipId, "字幕来源片段 ID"), sourceStart, sourceEnd };\n      if (binding.provenance !== void 0) {\n        const raw2 = object4(binding.provenance, ["path", "assetId", "start", "end"], "字幕实际音源");\n        const start2 = tick(raw2.start, "转写素材入点"), end = tick(raw2.end, "转写素材出点");\n        if (end <= start2) throw new Error("字幕实际音源须有正时长");\n        sourceBinding.provenance = {\n          path: list(raw2.path, 50, "嵌套音源路径").map((value2) => id(value2, "嵌套来源片段 ID")),\n          assetId: id(raw2.assetId, "转写素材 ID"),\n          start: start2,\n          end\n        };\n      }\n    }\n    let translation;\n    if (data.translation !== void 0) {\n      const translated = object4(\n        data.translation,\n        ["original", "language", "mode", "originalWords"],\n        "字幕翻译"\n      );\n      translation = {\n        original: text(translated.original, 1e4, "字幕原文", false, true),\n        language: text(translated.language, 80, "字幕语言"),\n        mode: choice(translated.mode, ["bilingual", "translated"], "字幕翻译模式")\n      };\n      if (translated.originalWords !== void 0) {\n        let previousStart2 = -1, previousEnd2 = -1;\n        translation.originalWords = list(translated.originalWords, 1e4, "字幕原文词时间").map(\n          (raw2) => {\n            const word = object4(raw2, ["text", "start", "end"], "原文词");\n            const start2 = integer2(word.start, 0, duration - 1, "原文词入点"), end = integer2(word.end, start2 + 1, duration, "原文词出点");\n            if (start2 < previousStart2 || end < previousEnd2)\n              throw new Error("原文词时间必须按顺序排列");\n            previousStart2 = start2;\n            previousEnd2 = end;\n            return { text: text(word.text, 1e3, "原文词"), start: start2, end };\n          }\n        );\n      }\n    }\n    return {\n      ...base,\n      kind: "text",\n      role: choice(data.role, ["title", "subtitle"], "文字用途"),\n      text: text(data.text, 1e4, "文字内容", true, true),\n      style: textStyle(data.style),\n      words,\n      ...sourceBinding ? { sourceBinding } : {},\n      ...translation ? { translation } : {}\n    };\n  }\n  function sequenceDuration(sequence2) {\n    let duration = 0;\n    for (const clip2 of sequence2.clips) {\n      const end = tick(clip2.start, "片段起点") + tick(clip2.duration, "片段时长", true);\n      if (end > MAX_EDITOR_TICK) throw new Error("序列超过 24 小时");\n      duration = Math.max(duration, end);\n    }\n    return duration;\n  }\n  function sequence(value, assets) {\n    const data = object4(\n      value,\n      [\n        "id",\n        "name",\n        "width",\n        "height",\n        "frameRate",\n        "background",\n        "timelineMode",\n        "magneticTrackId",\n        "tracks",\n        "clips",\n        "transitions",\n        "markers"\n      ],\n      "序列"\n    );\n    object4(data.frameRate, ["numerator", "denominator"], "序列帧率");\n    const tracks = list(data.tracks, 128, "轨道").map(track);\n    unique(tracks, "轨道");\n    const magneticTrackId = data.magneticTrackId === void 0 ? void 0 : id(data.magneticTrackId, "磁吸主轨 ID");\n    if (magneticTrackId !== void 0 && !tracks.some((track2) => track2.id === magneticTrackId && track2.kind === "video"))\n      throw new Error("磁吸主轨必须引用现有画面轨");\n    const clips = list(data.clips, 2e3, "片段").map((value2) => clip(value2, assets));\n    unique(clips, "片段");\n    const transitions = list(data.transitions, 2e3, "转场").map((raw) => {\n      const transition = object4(\n        raw,\n        ["id", "fromClipId", "toClipId", "start", "duration", "kind"],\n        "转场"\n      );\n      const start = tick(transition.start, "转场起点"), duration = tick(transition.duration, "转场时长", true);\n      if (start + duration > MAX_EDITOR_TICK) throw new Error("转场超过 24 小时");\n      return {\n        id: id(transition.id, "转场 ID"),\n        fromClipId: id(transition.fromClipId, "转场起始片段"),\n        toClipId: id(transition.toClipId, "转场结束片段"),\n        start,\n        duration,\n        kind: choice(\n          transition.kind,\n          ["dissolve", "fade-black", "wipe-left", "wipe-right", "push-left", "push-right"],\n          "转场类型"\n        )\n      };\n    });\n    unique(transitions, "转场");\n    const markers = list(data.markers, 1e4, "时间轴标记").map((raw) => {\n      const marker = object4(raw, ["id", "time", "duration", "name", "note", "color"], "时间轴标记");\n      const time = tick(marker.time, "标记时间"), duration = tick(marker.duration, "标记范围");\n      if (time + duration > MAX_EDITOR_TICK) throw new Error("标记范围超过 24 小时");\n      return {\n        id: id(marker.id, "标记 ID"),\n        time,\n        duration,\n        name: text(marker.name, 200, "标记名称"),\n        note: text(marker.note, 1e4, "标记备注", true, true),\n        color: color(marker.color, "标记颜色")\n      };\n    });\n    unique(markers, "标记");\n    return {\n      id: id(data.id, "序列 ID"),\n      name: text(data.name, 200, "序列名称"),\n      width: integer2(data.width, 16, 8192, "序列宽度"),\n      height: integer2(data.height, 16, 8192, "序列高度"),\n      frameRate: validateFrameRate(data.frameRate),\n      background: color(data.background, "序列背景"),\n      timelineMode: choice(data.timelineMode, ["magnetic", "free"], "排列方式"),\n      ...magneticTrackId === void 0 ? {} : { magneticTrackId },\n      tracks,\n      clips,\n      transitions,\n      markers\n    };\n  }\n  function compatibleTrack(clip2, track2, assets) {\n    if (clip2.kind === "text") return track2.kind === "text";\n    if (clip2.kind === "shape" || clip2.kind === "multicam") return track2.kind === "video";\n    if (clip2.kind === "sequence") return track2.kind !== "text";\n    const source = assets.get(clip2.assetId);\n    return source.kind === "audio" ? track2.kind === "audio" : source.kind === "video" ? track2.kind !== "text" : track2.kind === "video";\n  }\n  function multicamBounds(clip2, assets) {\n    const angles = new Map(clip2.angles.map((angle) => [angle.id, angle]));\n    function range(angleId, start, end) {\n      const angle = angles.get(angleId), source = assets.get(angle.assetId);\n      const coordinates = [\n        sourceTimeAt(clip2.timeMap, start),\n        ...clip2.timeMap.points.filter((point) => point.time > start && point.time < end).map((point) => point.source),\n        sourceTimeAt(clip2.timeMap, end)\n      ];\n      if (coordinates.some(\n        (position) => position + angle.offset < 0 || position + angle.offset > source.duration\n      ))\n        throw new Error(`机位 ${angle.name} 的画面或声音范围超出素材`);\n      if (coordinates.some(\n        (position, index) => index > 0 && position + angle.offset === source.duration && coordinates[index - 1] + angle.offset === source.duration\n      ))\n        throw new Error(`机位 ${angle.name} 不能在素材结束边界定格`);\n    }\n    for (const [index, change] of clip2.switches.entries())\n      range(change.angleId, change.time, clip2.switches[index + 1]?.time ?? clip2.duration);\n    const volume = clip2.audio.volume;\n    if (typeof volume === "number" ? volume > 0 : volume.keyframes.some((frame) => frame.value > 0))\n      range(clip2.audioAngleId, 0, clip2.duration);\n  }\n  function checkSequenceReferences(sequence2, assets, sequences) {\n    const tracks = new Map(sequence2.tracks.map((track2) => [track2.id, track2]));\n    const clips = new Map(sequence2.clips.map((clip2) => [clip2.id, clip2]));\n    for (const clip2 of sequence2.clips) {\n      const track2 = tracks.get(clip2.trackId);\n      if (!track2) throw new Error(`片段引用不存在的轨道：${clip2.trackId}`);\n      if (!compatibleTrack(clip2, track2, assets)) throw new Error(`片段 ${clip2.id} 与轨道类型不兼容`);\n      if (clip2.kind === "sequence") {\n        const source = sequences.get(clip2.sequenceId);\n        if (!source) throw new Error(`嵌套引用不存在的序列：${clip2.sequenceId}`);\n        const sourceDuration = sequenceDuration(source);\n        if (!sourceDuration) throw new Error("嵌套片段不能引用空序列");\n        validateTimeMap(clip2.timeMap, clip2.duration, sourceDuration);\n        assertNoEmptyHold(clip2.timeMap, sourceDuration, "嵌套片段");\n      }\n      if (clip2.kind === "multicam") multicamBounds(clip2, assets);\n      if ("audio" in clip2 && clip2.audio.ducking)\n        for (const trackId of clip2.audio.ducking.sidechainTrackIds) {\n          const source = tracks.get(trackId);\n          if (!source || source.kind === "text" || source.id === clip2.trackId)\n            throw new Error("压低背景声须引用其他有效声音轨道");\n        }\n      if (clip2.kind === "text" && clip2.sourceBinding) {\n        const binding = clip2.sourceBinding, source = clips.get(binding.clipId);\n        if (!source || !("timeMap" in source)) throw new Error("字幕来源须引用有效的媒体或序列片段");\n        const sourceSequence = source.kind === "sequence" ? sequences.get(source.sequenceId) : void 0;\n        if (source.kind === "sequence" && !sourceSequence)\n          throw new Error("字幕来源引用不存在的嵌套序列");\n        const sourceDuration = source.kind === "media" ? assets.get(source.assetId).duration : source.kind === "sequence" ? sequenceDuration(sourceSequence) : MAX_EDITOR_TICK;\n        if (binding.sourceEnd > sourceDuration) throw new Error("字幕来源范围超出素材");\n        if (binding.provenance) {\n          let leaf = source;\n          for (const clipId of binding.provenance.path) {\n            if (leaf.kind !== "sequence") throw new Error("字幕嵌套音源路径须经过序列片段");\n            const child = sequences.get(leaf.sequenceId)?.clips.find((item) => item.id === clipId);\n            if (!child || !("timeMap" in child)) throw new Error("字幕嵌套音源不存在");\n            leaf = child;\n          }\n          const assetId = leaf.kind === "media" ? leaf.assetId : leaf.kind === "multicam" ? leaf.angles.find((angle) => angle.id === leaf.audioAngleId)?.assetId : void 0;\n          const asset2 = assets.get(binding.provenance.assetId);\n          if (assetId !== binding.provenance.assetId || !asset2 || !["audio", "video"].includes(asset2.kind) || binding.provenance.end > asset2.duration)\n            throw new Error("字幕实际音源或转写范围与来源片段不一致");\n        }\n      }\n    }\n    const pairs = /* @__PURE__ */ new Set();\n    for (const transition of sequence2.transitions) {\n      const from = clips.get(transition.fromClipId), to = clips.get(transition.toClipId);\n      if (!from || !to || from.id === to.id || from.trackId !== to.trackId || tracks.get(from.trackId)?.kind !== "video")\n        throw new Error("转场两端须为同一画面轨的两个有效片段");\n      const end = from.start + from.duration;\n      if (from.start >= to.start || end >= to.start + to.duration || to.start >= end || transition.start !== to.start || transition.duration !== end - to.start)\n        throw new Error("转场时间须精确覆盖前后片段的重叠范围");\n      const key = JSON.stringify([from.id, to.id]);\n      if (pairs.has(key)) throw new Error("同一片段交界不能重复设置转场");\n      pairs.add(key);\n    }\n    for (const track2 of sequence2.tracks.filter((track3) => track3.kind === "video")) {\n      const placed = sequence2.clips.filter((clip2) => clip2.trackId === track2.id).sort((a, b) => a.start - b.start || a.duration - b.duration);\n      let active = [];\n      for (const clip2 of placed) {\n        active = active.filter((previous) => previous.start + previous.duration > clip2.start);\n        if (active.length > 1) throw new Error("同一画面轨不能同时重叠三个片段");\n        for (const previous of active)\n          if (!pairs.has(JSON.stringify([previous.id, clip2.id])))\n            throw new Error("同轨画面重叠需要明确的转场");\n        active.push(clip2);\n      }\n    }\n  }\n  function validateEditorDocument(value) {\n    const data = object4(\n      copyData(value),\n      [\n        "schemaVersion",\n        "timebase",\n        "id",\n        "name",\n        "revision",\n        "assets",\n        "sequences",\n        "activeSequenceId",\n        "exportProfiles",\n        "production"\n      ],\n      "工程"\n    );\n    if (data.schemaVersion !== 2 || data.timebase !== TICKS_PER_SECOND)\n      throw new Error("不支持此工程版本或时间基准");\n    const assets = list(data.assets, 1e3, "素材").map(asset), assetsById = unique(assets, "素材");\n    const sequences = list(data.sequences, 50, "序列", 1).map((value2) => sequence(value2, assetsById));\n    const sequencesById = unique(sequences, "序列");\n    const activeSequenceId = id(data.activeSequenceId, "活动序列 ID");\n    if (!sequencesById.has(activeSequenceId)) throw new Error("活动序列不存在");\n    for (const sequence2 of sequences) checkSequenceReferences(sequence2, assetsById, sequencesById);\n    const visiting = /* @__PURE__ */ new Set(), visited = /* @__PURE__ */ new Set();\n    function acyclic(id2) {\n      if (visiting.has(id2)) throw new Error("嵌套序列不能循环引用");\n      if (visited.has(id2)) return;\n      visiting.add(id2);\n      for (const clip2 of sequencesById.get(id2).clips)\n        if (clip2.kind === "sequence") acyclic(clip2.sequenceId);\n      visiting.delete(id2);\n      visited.add(id2);\n    }\n    for (const sequence2 of sequences) acyclic(sequence2.id);\n    const exportProfiles = list(data.exportProfiles, 64, "导出配置").map(validateExportProfile);\n    unique(exportProfiles, "导出配置");\n    return {\n      schemaVersion: 2,\n      timebase: TICKS_PER_SECOND,\n      id: id(data.id, "工程 ID"),\n      name: text(data.name, 200, "工程名称"),\n      revision: integer2(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "修订号"),\n      assets,\n      sequences,\n      activeSequenceId,\n      exportProfiles,\n      ...data.production === void 0 ? {} : { production: dataObject(data.production, "制作记录") }\n    };\n  }\n\n  // src/editor/evaluate.ts\n  var neutralAudio = () => ({\n    gain: 1,\n    pan: 0,\n    pitchSemitones: 0,\n    preservePitch: true,\n    playbackRate: 1,\n    fadeGain: 1,\n    ducking: [],\n    trackInstancePath: []\n  });\n  var clamp3 = (value, min, max) => Math.max(min, Math.min(max, value));\n  var pathPart = (kind, id2) => `${kind}:${encodeURIComponent(id2)}`;\n  var inside = (clip2, time) => time >= clip2.start && time - clip2.start < clip2.duration;\n  function resolveTransform(value, local) {\n    const number2 = (key) => evaluateAnimatedNumber(value[key], local);\n    return {\n      x: clamp3(number2("x"), -10, 10),\n      y: clamp3(number2("y"), -10, 10),\n      scaleX: clamp3(number2("scaleX"), 0, 100),\n      scaleY: clamp3(number2("scaleY"), 0, 100),\n      rotation: clamp3(number2("rotation"), -36e4, 36e4),\n      opacity: clamp3(number2("opacity"), 0, 1),\n      flipX: value.flipX,\n      flipY: value.flipY,\n      fit: value.fit,\n      crop: { ...value.crop }\n    };\n  }\n  function resolveColor(value, local) {\n    const number2 = (key) => evaluateAnimatedNumber(value[key], local);\n    return {\n      exposure: clamp3(number2("exposure"), -10, 10),\n      brightness: clamp3(number2("brightness"), -1, 1),\n      contrast: clamp3(number2("contrast"), 0, 4),\n      saturation: clamp3(number2("saturation"), 0, 4),\n      temperature: clamp3(number2("temperature"), -1, 1),\n      tint: clamp3(number2("tint"), -1, 1),\n      hue: clamp3(number2("hue"), -360, 360),\n      curves: value.curves.map((curve) => ({\n        ...curve,\n        points: curve.points.map((point) => ({ ...point }))\n      })),\n      hsl: value.hsl.map((range) => ({ ...range }))\n    };\n  }\n  function timeMapRate(map, time) {\n    let left = 0, right = map.points.length - 1;\n    while (left + 1 < right) {\n      const middle = left + Math.floor((right - left) / 2);\n      if (map.points[middle].time <= time) left = middle;\n      else right = middle;\n    }\n    const a = map.points[left], b = map.points[right];\n    return (b.source - a.source) / (b.time - a.time);\n  }\n  function audioContext(clip2, track2, local, parent, sequenceId, sequencePath) {\n    const mix = clip2.audio;\n    const fade = (mix.fadeIn ? clamp3(local / mix.fadeIn, 0, 1) : 1) * (mix.fadeOut ? clamp3((clip2.duration - local) / mix.fadeOut, 0, 1) : 1);\n    const playbackRate = parent.playbackRate * timeMapRate(clip2.timeMap, local);\n    const ducking = parent.ducking.map((item) => ({\n      ...item,\n      sidechainTrackIds: [...item.sidechainTrackIds],\n      sidechainTrackInstanceIds: [...item.sidechainTrackInstanceIds]\n    }));\n    if (mix.ducking)\n      ducking.push({\n        ...mix.ducking,\n        sidechainTrackIds: [...mix.ducking.sidechainTrackIds],\n        sequenceId,\n        sequenceTime: clip2.start + local,\n        trackInstanceId: `${sequencePath}/${pathPart("track", track2.id)}`,\n        sidechainTrackInstanceIds: mix.ducking.sidechainTrackIds.map(\n          (id2) => `${sequencePath}/${pathPart("track", id2)}`\n        )\n      });\n    return {\n      gain: track2.muted || !playbackRate ? 0 : clamp3(evaluateAnimatedNumber(mix.volume, local), 0, 4) * track2.volume * fade * parent.gain,\n      pan: clamp3(\n        parent.pan + track2.pan + clamp3(evaluateAnimatedNumber(mix.pan, local), -1, 1),\n        -1,\n        1\n      ),\n      pitchSemitones: parent.pitchSemitones + mix.pitchSemitones,\n      preservePitch: parent.preservePitch && mix.preservePitch,\n      playbackRate,\n      fadeGain: parent.fadeGain * fade,\n      ducking,\n      trackInstancePath: [\n        ...parent.trackInstancePath,\n        `${sequencePath}/${pathPart("track", track2.id)}`\n      ]\n    };\n  }\n  function prepareEvaluator(value) {\n    const document2 = validateEditorDocument(value);\n    const assets = new Map(document2.assets.map((asset2) => [asset2.id, asset2]));\n    const sequences = new Map(document2.sequences.map((sequence2) => [sequence2.id, sequence2]));\n    const durations = new Map(\n      document2.sequences.map((sequence2) => [sequence2.id, sequenceDuration(sequence2)])\n    );\n    const tracks = new Map(\n      document2.sequences.map((sequence2) => [\n        sequence2.id,\n        sequence2.tracks.map((track2) => ({\n          track: track2,\n          clips: sequence2.clips.filter((clip2) => clip2.trackId === track2.id).sort((a, b) => a.start - b.start)\n        }))\n      ])\n    );\n    function evaluateSequence(sequence2, tick2, sequencePath, parent, visible) {\n      const frame = {\n        sequenceId: sequence2.id,\n        time: tick2,\n        width: sequence2.width,\n        height: sequence2.height,\n        background: sequence2.background,\n        layers: [],\n        audio: []\n      };\n      if (tick2 >= durations.get(sequence2.id)) return frame;\n      for (const { track: track2, clips } of tracks.get(sequence2.id)) {\n        const visual2 = /* @__PURE__ */ new Map();\n        const active = clips.filter((clip2) => inside(clip2, tick2));\n        const picture = visible && !track2.hidden && track2.kind !== "audio";\n        for (const clip2 of active) {\n          const localTime = tick2 - clip2.start;\n          const instanceId = `${sequencePath}/${pathPart("clip", clip2.id)}`;\n          const base = () => ({\n            instanceId,\n            sequenceId: sequence2.id,\n            clipId: clip2.id,\n            trackId: track2.id,\n            localTime,\n            transform: resolveTransform(clip2.transform, localTime),\n            color: resolveColor(clip2.color, localTime),\n            blendMode: clip2.blendMode,\n            ...clip2.mask ? { mask: structuredClone(clip2.mask) } : {}\n          });\n          const mediaLayer = (asset2, sourceTime, angleId) => picture && asset2.kind !== "audio" && sourceTime >= 0 && (asset2.kind === "image" || sourceTime < asset2.duration) ? {\n            ...base(),\n            kind: "media",\n            assetId: asset2.id,\n            assetKind: asset2.kind,\n            sourceTime,\n            naturalWidth: asset2.width ?? sequence2.width,\n            naturalHeight: asset2.height ?? sequence2.height,\n            ...angleId ? { angleId } : {}\n          } : null;\n          const addAudio = (asset2, sourceTime, context2, angleId) => {\n            if (asset2.kind !== "video" && asset2.kind !== "audio" || sourceTime < 0 || sourceTime >= asset2.duration)\n              return;\n            frame.audio.push({\n              ...context2,\n              instanceId: `${instanceId}/audio`,\n              sequenceId: sequence2.id,\n              clipId: clip2.id,\n              trackId: track2.id,\n              trackInstanceId: `${sequencePath}/${pathPart("track", track2.id)}`,\n              assetId: asset2.id,\n              sourceTime,\n              localTime,\n              ...angleId ? { angleId } : {}\n            });\n          };\n          if (clip2.kind === "media") {\n            const asset2 = assets.get(clip2.assetId), sourceTime = sourceTimeAt(clip2.timeMap, localTime);\n            visual2.set(clip2.id, mediaLayer(asset2, sourceTime));\n            addAudio(\n              asset2,\n              sourceTime,\n              audioContext(clip2, track2, localTime, parent, sequence2.id, sequencePath)\n            );\n          } else if (clip2.kind === "multicam") {\n            const source = sourceTimeAt(clip2.timeMap, localTime);\n            let switchIndex = clip2.switches.length - 1;\n            while (switchIndex > 0 && clip2.switches[switchIndex].time > localTime) switchIndex--;\n            const activeSwitch = clip2.switches[switchIndex];\n            const angle = clip2.angles.find((item) => item.id === activeSwitch.angleId);\n            const audioAngle = clip2.angles.find((item) => item.id === clip2.audioAngleId);\n            visual2.set(\n              clip2.id,\n              mediaLayer(assets.get(angle.assetId), source + angle.offset, angle.id)\n            );\n            addAudio(\n              assets.get(audioAngle.assetId),\n              source + audioAngle.offset,\n              audioContext(clip2, track2, localTime, parent, sequence2.id, sequencePath),\n              audioAngle.id\n            );\n          } else if (clip2.kind === "sequence") {\n            const sourceTime = sourceTimeAt(clip2.timeMap, localTime), nested = sequences.get(clip2.sequenceId);\n            const child = evaluateSequence(\n              nested,\n              sourceTime,\n              `${instanceId}/${pathPart("sequence", nested.id)}`,\n              audioContext(clip2, track2, localTime, parent, sequence2.id, sequencePath),\n              picture\n            );\n            frame.audio.push(...child.audio);\n            visual2.set(\n              clip2.id,\n              picture && sourceTime < durations.get(nested.id) ? {\n                ...base(),\n                kind: "group",\n                sourceSequenceId: nested.id,\n                sourceTime,\n                width: nested.width,\n                height: nested.height,\n                background: nested.background,\n                layers: child.layers\n              } : null\n            );\n          } else if (clip2.kind === "text") {\n            visual2.set(\n              clip2.id,\n              picture ? {\n                ...base(),\n                kind: "text",\n                role: clip2.role,\n                text: clip2.text,\n                style: structuredClone(clip2.style),\n                words: clip2.words.map((word) => ({ ...word })),\n                activeWordIndices: clip2.words.flatMap(\n                  (word, index) => localTime >= word.start && localTime < word.end ? [index] : []\n                ),\n                animationProgress: localTime / clip2.duration\n              } : null\n            );\n          } else {\n            visual2.set(\n              clip2.id,\n              picture ? {\n                ...base(),\n                kind: "shape",\n                shape: clip2.shape,\n                fill: clip2.fill,\n                stroke: clip2.stroke,\n                strokeWidth: clip2.strokeWidth\n              } : null\n            );\n          }\n        }\n        if (!picture) continue;\n        const transitionByClip = /* @__PURE__ */ new Map();\n        for (const transition of sequence2.transitions) {\n          if (tick2 < transition.start || tick2 - transition.start >= transition.duration || !visual2.has(transition.fromClipId) || !visual2.has(transition.toClipId))\n            continue;\n          transitionByClip.set(transition.fromClipId, transition);\n          transitionByClip.set(transition.toClipId, transition);\n        }\n        const emitted = /* @__PURE__ */ new Set();\n        for (const clip2 of active) {\n          const transition = transitionByClip.get(clip2.id);\n          if (transition) {\n            if (emitted.has(transition.id)) continue;\n            emitted.add(transition.id);\n            frame.layers.push({\n              kind: "transition",\n              instanceId: `${sequencePath}/${pathPart("transition", transition.id)}`,\n              sequenceId: sequence2.id,\n              trackId: track2.id,\n              transitionId: transition.id,\n              transitionKind: transition.kind,\n              progress: (tick2 - transition.start) / transition.duration,\n              from: visual2.get(transition.fromClipId) ?? null,\n              to: visual2.get(transition.toClipId) ?? null\n            });\n          } else {\n            const layer = visual2.get(clip2.id);\n            if (layer) frame.layers.push(layer);\n          }\n        }\n      }\n      return frame;\n    }\n    return {\n      evaluate(sequenceId, tick2) {\n        assertTick(tick2, "求值时间");\n        const sequence2 = sequences.get(sequenceId);\n        if (!sequence2) throw new Error("待求值的序列不存在");\n        return evaluateSequence(\n          sequence2,\n          tick2,\n          pathPart("sequence", sequenceId),\n          neutralAudio(),\n          true\n        );\n      }\n    };\n  }\n\n  // src/demo-drawing.ts\n  function rounded(ctx, x, y, w, h, radius, fill) {\n    ctx.fillStyle = fill;\n    ctx.beginPath();\n    ctx.roundRect(x, y, w, h, radius);\n    ctx.fill();\n  }\n  function drawDemo(ctx, width, height, index, frame) {\n    ctx.save();\n    const s = Math.min(width / 1280, height / 720);\n    ctx.fillStyle = "#101918";\n    ctx.fillRect(0, 0, width, height);\n    ctx.translate((width - 1280 * s) / 2, (height - 720 * s) / 2);\n    ctx.scale(s, s);\n    const gradient = ctx.createLinearGradient(0, 0, 1280, 720);\n    gradient.addColorStop(0, "#123b35");\n    gradient.addColorStop(0.55, "#112b29");\n    gradient.addColorStop(1, "#111a22");\n    ctx.fillStyle = gradient;\n    ctx.fillRect(0, 0, 1280, 720);\n    ctx.strokeStyle = "#95c5ad0c";\n    ctx.lineWidth = 1;\n    for (let x = 0; x < 1280; x += 64) {\n      ctx.beginPath();\n      ctx.moveTo(x, 0);\n      ctx.lineTo(x, 720);\n      ctx.stroke();\n    }\n    for (let y = 0; y < 720; y += 64) {\n      ctx.beginPath();\n      ctx.moveTo(0, y);\n      ctx.lineTo(1280, y);\n      ctx.stroke();\n    }\n    ctx.fillStyle = "#bceac9";\n    ctx.font = "500 18px system-ui";\n    ctx.fillText("MIMI STUDIO   /   CREATE SOMETHING GOOD", 82, 90);\n    rounded(ctx, 82, 170, 124, 34, 17, "#a6e5be19");\n    ctx.fillStyle = "#bceac9";\n    ctx.font = "500 15px system-ui";\n    ctx.fillText(["01 / THE IDEA", "02 / THE EDIT", "03 / YOUR STORY"][index % 3], 98, 193);\n    ctx.fillStyle = "#edf7ee";\n    ctx.font = "600 76px system-ui";\n    ctx.fillText(["从想法，", "让每一帧，", "你的故事，"][index % 3], 78, 316);\n    ctx.fillStyle = "#b6efca";\n    ctx.fillText(["到成片。", "恰到好处。", "现在开始。 "][index % 3], 78, 416);\n    ctx.fillStyle = "#b5c6c1";\n    ctx.font = "400 23px system-ui";\n    ctx.fillText("留住值得讲述的瞬间。其余的，交给剪辑。", 82, 480);\n    const p = frame / 30;\n    ctx.save();\n    ctx.translate(957, 337);\n    ctx.rotate(-0.2 + Math.sin(p * 0.3) * 0.025);\n    rounded(ctx, -158, -187, 288, 370, 24, "#0b171acc");\n    rounded(ctx, -141, -170, 254, 243, 12, "#397765");\n    const g = ctx.createLinearGradient(-141, -170, 113, 73);\n    g.addColorStop(0, "#9bd5a4");\n    g.addColorStop(1, "#254e4f");\n    rounded(ctx, -141, -170, 254, 243, 12, g);\n    ctx.fillStyle = "#e3ecc6";\n    ctx.beginPath();\n    ctx.arc(38, -94, 33, 0, Math.PI * 2);\n    ctx.fill();\n    ctx.fillStyle = "#204f45";\n    ctx.beginPath();\n    ctx.moveTo(-141, 73);\n    ctx.lineTo(-64, -77);\n    ctx.lineTo(48, 73);\n    ctx.fill();\n    ctx.fillStyle = "#163a37";\n    ctx.beginPath();\n    ctx.moveTo(-37, 73);\n    ctx.lineTo(60, -34);\n    ctx.lineTo(113, 73);\n    ctx.fill();\n    rounded(ctx, -141, 99, 157, 9, 4, "#d9e9e0");\n    rounded(ctx, -141, 122, 225, 6, 3, "#45655a");\n    rounded(ctx, -141, 140, 178, 6, 3, "#45655a");\n    ctx.restore();\n    rounded(ctx, 827, 506, 271, 59, 12, "#b9edc6");\n    ctx.fillStyle = "#173c2d";\n    ctx.font = "500 19px system-ui";\n    ctx.fillText("▶   Made of little moments", 845, 543);\n    ctx.fillStyle = "#8dafa0";\n    ctx.font = "400 15px system-ui";\n    ctx.fillText("示例画面 · 可自由剪辑与导出", 82, 643);\n    ctx.restore();\n  }\n\n  // src/editor/media-pool.ts\n  var MediaPoolError = class extends Error {\n    constructor(code, message, options) {\n      super(message, options);\n      this.code = code;\n      this.name = code === "aborted" ? "AbortError" : "MediaPoolError";\n    }\n    code;\n  };\n  var aborted = () => new MediaPoolError("aborted", "画面准备已取消或被较新的请求替代");\n  function assertActive(signal) {\n    if (signal.aborted) throw aborted();\n  }\n  function boundedInteger(value, min, max, label2) {\n    if (!Number.isSafeInteger(value) || value < min || value > max)\n      throw new Error(`${label2}必须是 ${min}–${max} 范围内的整数`);\n    return value;\n  }\n  function requiredMedia(frame) {\n    const required = /* @__PURE__ */ new Map();\n    function visit(layer) {\n      if (layer.kind === "group") layer.layers.forEach(visit);\n      else if (layer.kind === "transition") {\n        if (layer.from) visit(layer.from);\n        if (layer.to) visit(layer.to);\n      } else if (layer.kind === "media") {\n        const previous = required.get(layer.instanceId);\n        if (previous && (previous.assetId !== layer.assetId || previous.assetKind !== layer.assetKind || previous.sourceTime !== layer.sourceTime))\n          throw new MediaPoolError("conflict", `同一画面实例包含不同素材或时间：${layer.instanceId}`);\n        if (layer.assetKind === "audio")\n          throw new MediaPoolError("decode", "声音素材不能作为画面解码");\n        required.set(layer.instanceId, layer);\n      }\n    }\n    frame.layers.forEach(visit);\n    return required;\n  }\n  function waitFor(promise, signal, timeoutMs, timeoutMessage) {\n    return new Promise((resolve, reject) => {\n      let settled = false;\n      const finish = (error, result) => {\n        if (settled) return;\n        settled = true;\n        clearTimeout(timer);\n        signal.removeEventListener("abort", cancel);\n        error === void 0 ? resolve(result) : reject(error);\n      };\n      const cancel = () => finish(aborted());\n      const timer = setTimeout(\n        () => finish(new MediaPoolError("timeout", timeoutMessage)),\n        timeoutMs\n      );\n      signal.addEventListener("abort", cancel, { once: true });\n      promise.then(\n        (result) => finish(void 0, result),\n        (error) => finish(error)\n      );\n      if (signal.aborted) cancel();\n    });\n  }\n  function videoReady(video) {\n    return !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;\n  }\n  function loadVideo(video, url, signal, timeoutMs, assetId) {\n    return new Promise((resolve, reject) => {\n      let settled = false;\n      const events = ["loadedmetadata", "loadeddata", "canplay"];\n      const finish = (error) => {\n        if (settled) return;\n        settled = true;\n        clearTimeout(timer);\n        for (const event of events) video.removeEventListener(event, inspect);\n        video.removeEventListener("error", failed);\n        signal.removeEventListener("abort", cancel);\n        error ? reject(error) : resolve();\n      };\n      const inspect = () => {\n        if (videoReady(video)) finish();\n      };\n      const failed = () => finish(new MediaPoolError("decode", `无法解码视频素材：${assetId}`));\n      const cancel = () => finish(aborted());\n      const timer = setTimeout(\n        () => finish(new MediaPoolError("timeout", `视频素材加载超时：${assetId}`)),\n        timeoutMs\n      );\n      for (const event of events) video.addEventListener(event, inspect);\n      video.addEventListener("error", failed);\n      signal.addEventListener("abort", cancel, { once: true });\n      if (signal.aborted) {\n        cancel();\n        return;\n      }\n      video.src = url;\n      video.load();\n      inspect();\n    });\n  }\n  function seekVideo(video, seconds, signal, timeoutMs, assetId) {\n    return new Promise((resolve, reject) => {\n      let settled = false, sought = false, decoded = false;\n      let callback;\n      const supportsCallback = typeof video.requestVideoFrameCallback === "function";\n      const finish = (error) => {\n        if (settled) return;\n        settled = true;\n        clearTimeout(timer);\n        if (callback !== void 0) video.cancelVideoFrameCallback(callback);\n        video.removeEventListener("seeked", onSeeked);\n        video.removeEventListener("loadeddata", inspect);\n        video.removeEventListener("canplay", inspect);\n        video.removeEventListener("error", failed);\n        signal.removeEventListener("abort", cancel);\n        error ? reject(error) : resolve();\n      };\n      const inspect = () => {\n        if (sought && decoded && videoReady(video) && Math.abs(video.currentTime - seconds) < 1e-5)\n          finish();\n      };\n      const onSeeked = () => {\n        sought = true;\n        if (!supportsCallback) decoded = true;\n        inspect();\n      };\n      const failed = () => finish(new MediaPoolError("decode", `视频寻帧失败：${assetId}`));\n      const cancel = () => finish(aborted());\n      const timer = setTimeout(\n        () => finish(new MediaPoolError("timeout", `视频寻帧或解码超时：${assetId}`)),\n        timeoutMs\n      );\n      video.addEventListener("seeked", onSeeked);\n      video.addEventListener("loadeddata", inspect);\n      video.addEventListener("canplay", inspect);\n      video.addEventListener("error", failed);\n      signal.addEventListener("abort", cancel, { once: true });\n      if (signal.aborted) {\n        cancel();\n        return;\n      }\n      try {\n        if (supportsCallback)\n          callback = video.requestVideoFrameCallback(() => {\n            callback = void 0;\n            decoded = true;\n            inspect();\n          });\n        video.currentTime = seconds;\n      } catch (cause) {\n        finish(new MediaPoolError("decode", `无法定位视频素材：${assetId}`, { cause }));\n      }\n    });\n  }\n  var EditorMediaPool = class {\n    constructor(options) {\n      this.options = options;\n      if (typeof options.resolveAsset !== "function") throw new Error("必须提供素材资源解析器");\n      this.maxInstances = boundedInteger(options.maxInstances ?? 32, 1, 256, "同时解码实例上限");\n      this.timeoutMs = boundedInteger(options.timeoutMs ?? 15e3, 1, 12e4, "媒体等待时限");\n    }\n    options;\n    maxInstances;\n    timeoutMs;\n    instances = /* @__PURE__ */ new Map();\n    resources = /* @__PURE__ */ new Map();\n    urlLifetimes = /* @__PURE__ */ new Map();\n    pending;\n    generation = 0;\n    disposed = false;\n    releaseInstance(instanceId) {\n      const instance = this.instances.get(instanceId);\n      if (!instance) return;\n      this.instances.delete(instanceId);\n      instance.bitmap?.close();\n      if (instance.element instanceof HTMLVideoElement) instance.element.pause();\n      instance.element.removeAttribute("src");\n      if (instance.element instanceof HTMLVideoElement) instance.element.load();\n      if (instance.element instanceof HTMLCanvasElement) {\n        instance.element.width = 0;\n        instance.element.height = 0;\n      }\n      instance.element.remove();\n    }\n    retainResource(resource) {\n      const lifetime = this.urlLifetimes.get(resource.url) ?? { references: 0, owned: false };\n      lifetime.references++;\n      lifetime.owned ||= Boolean(resource.owned);\n      this.urlLifetimes.set(resource.url, lifetime);\n    }\n    releaseResource(resource) {\n      const lifetime = this.urlLifetimes.get(resource.url);\n      if (!lifetime) return;\n      lifetime.references--;\n      if (lifetime.references) return;\n      this.urlLifetimes.delete(resource.url);\n      if (lifetime.owned) URL.revokeObjectURL(resource.url);\n    }\n    clearResources() {\n      for (const instanceId of this.instances.keys()) this.releaseInstance(instanceId);\n      for (const resource of this.resources.values()) this.releaseResource(resource);\n      this.resources.clear();\n    }\n    /** Cancel pending work, release all decoders/owned URLs, and permit a new generation. */\n    reset() {\n      this.generation++;\n      this.pending?.controller.abort();\n      this.pending = void 0;\n      this.clearResources();\n    }\n    dispose() {\n      this.disposed = true;\n      this.reset();\n    }\n    async resource(assetId, request) {\n      const existing = this.resources.get(assetId);\n      if (existing) return existing;\n      const promise = Promise.resolve().then(() => {\n        assertActive(request.controller.signal);\n        return this.options.resolveAsset(assetId, request.controller.signal);\n      }).then(\n        (result) => {\n          const raw = typeof result === "string" ? { url: result } : result;\n          if (!raw || typeof raw.url !== "string" || !raw.url.trim() || raw.owned !== void 0 && typeof raw.owned !== "boolean" || raw.owned && !raw.url.startsWith("blob:"))\n            throw new MediaPoolError("resolve", `素材资源 URL 或所有权无效：${assetId}`);\n          const resource = { assetId, url: raw.url, owned: raw.owned ?? false };\n          this.retainResource(resource);\n          if (request.controller.signal.aborted || request.generation !== this.generation || this.disposed) {\n            this.releaseResource(resource);\n            throw aborted();\n          }\n          this.resources.set(assetId, resource);\n          return resource;\n        },\n        (cause) => {\n          if (request.controller.signal.aborted) throw aborted();\n          throw new MediaPoolError("resolve", `无法读取素材资源：${assetId}`, { cause });\n        }\n      );\n      return waitFor(\n        promise,\n        request.controller.signal,\n        this.timeoutMs,\n        `素材资源解析超时：${assetId}`\n      );\n    }\n    async decode(layer, request) {\n      const signal = request.controller.signal;\n      assertActive(signal);\n      let instance = this.instances.get(layer.instanceId);\n      if (layer.assetKind === "demo") {\n        if (!instance) {\n          instance = {\n            assetId: layer.assetId,\n            kind: "demo",\n            element: document.createElement("canvas")\n          };\n          this.instances.set(layer.instanceId, instance);\n        }\n        const canvas = instance.element;\n        if (instance.preparedSource !== layer.sourceTime || canvas.width !== layer.naturalWidth || canvas.height !== layer.naturalHeight) {\n          canvas.width = layer.naturalWidth;\n          canvas.height = layer.naturalHeight;\n          const context2 = canvas.getContext("2d");\n          if (!context2) throw new MediaPoolError("decode", "无法创建示例画面");\n          const index = layer.assetId === "demo-city" ? 1 : layer.assetId === "demo-outro" ? 2 : 0;\n          drawDemo(\n            context2,\n            canvas.width,\n            canvas.height,\n            index,\n            ticksToSeconds(layer.sourceTime) * 30\n          );\n          instance.preparedSource = layer.sourceTime;\n        }\n        return canvas;\n      }\n      const resource = this.resources.get(layer.assetId);\n      if (!instance) {\n        const element2 = layer.assetKind === "image" ? new Image() : document.createElement("video");\n        element2.crossOrigin = "anonymous";\n        instance = { assetId: layer.assetId, kind: layer.assetKind, element: element2 };\n        this.instances.set(layer.instanceId, instance);\n        if (element2 instanceof HTMLVideoElement) {\n          element2.muted = true;\n          element2.defaultMuted = true;\n          element2.playsInline = true;\n          element2.preload = "auto";\n          await loadVideo(element2, resource.url, signal, this.timeoutMs, layer.assetId);\n        } else {\n          element2.src = resource.url;\n          try {\n            await waitFor(element2.decode(), signal, this.timeoutMs, `图片解码超时：${layer.assetId}`);\n          } catch (cause) {\n            if (cause instanceof MediaPoolError) throw cause;\n            throw new MediaPoolError("decode", `无法解码图片素材：${layer.assetId}`, { cause });\n          }\n          if (!element2.naturalWidth || !element2.naturalHeight)\n            throw new MediaPoolError("decode", `图片没有可用画面：${layer.assetId}`);\n          if (typeof createImageBitmap !== "function")\n            throw new MediaPoolError("decode", "当前浏览器无法冻结图片的静态首帧");\n          const owner = instance;\n          const freezing = createImageBitmap(element2).then((bitmap) => {\n            if (signal.aborted || request.generation !== this.generation || this.instances.get(layer.instanceId) !== owner) {\n              bitmap.close();\n              throw aborted();\n            }\n            owner.bitmap = bitmap;\n            return bitmap;\n          });\n          try {\n            await waitFor(freezing, signal, this.timeoutMs, `图片首帧准备超时：${layer.assetId}`);\n          } catch (cause) {\n            if (cause instanceof MediaPoolError) throw cause;\n            throw new MediaPoolError("decode", `无法冻结图片首帧：${layer.assetId}`, { cause });\n          }\n          element2.removeAttribute("src");\n        }\n      }\n      assertActive(signal);\n      const element = instance.element;\n      if (element instanceof HTMLVideoElement) {\n        const seconds = ticksToSeconds(layer.sourceTime);\n        if (Number.isFinite(element.duration) && seconds >= element.duration)\n          throw new MediaPoolError("decode", `请求画面已超出视频源时长：${layer.assetId}`);\n        if (instance.preparedSource !== layer.sourceTime || !videoReady(element) || Math.abs(element.currentTime - seconds) >= 1e-5)\n          await seekVideo(element, seconds, signal, this.timeoutMs, layer.assetId);\n        assertActive(signal);\n        instance.preparedSource = layer.sourceTime;\n      }\n      return instance.bitmap ?? element;\n    }\n    async prepare(frame, signal) {\n      if (this.disposed) throw new MediaPoolError("disposed", "媒体解码池已释放");\n      if (this.pending) this.reset();\n      const request = { controller: new AbortController(), generation: this.generation };\n      this.pending = request;\n      const cancel = () => {\n        request.controller.abort();\n        if (this.pending === request) this.clearResources();\n      };\n      signal?.addEventListener("abort", cancel, { once: true });\n      if (signal?.aborted) cancel();\n      try {\n        assertActive(request.controller.signal);\n        const required = requiredMedia(frame);\n        if (required.size > this.maxInstances)\n          throw new MediaPoolError(\n            "capacity",\n            `当前画面需要 ${required.size} 个解码实例，超过上限 ${this.maxInstances}`\n          );\n        const assetIds = new Set(\n          [...required.values()].filter((layer) => layer.assetKind !== "demo").map((layer) => layer.assetId)\n        );\n        for (const [id2, instance] of this.instances) {\n          const layer = required.get(id2);\n          if (!layer || layer.assetId !== instance.assetId || layer.assetKind !== instance.kind)\n            this.releaseInstance(id2);\n        }\n        for (const [id2, resource] of this.resources) {\n          if (assetIds.has(id2)) continue;\n          this.resources.delete(id2);\n          this.releaseResource(resource);\n        }\n        await Promise.all([...assetIds].map((id2) => this.resource(id2, request)));\n        assertActive(request.controller.signal);\n        const surfaces = await Promise.all(\n          [...required.values()].map(\n            async (layer) => [layer.instanceId, await this.decode(layer, request)]\n          )\n        );\n        assertActive(request.controller.signal);\n        return new Map(surfaces);\n      } catch (error) {\n        if (this.pending === request) {\n          request.controller.abort();\n          this.clearResources();\n        }\n        throw error;\n      } finally {\n        signal?.removeEventListener("abort", cancel);\n        if (this.pending === request) this.pending = void 0;\n      }\n    }\n  };\n\n  // src/editor/render-entry.ts\n  function withoutSubtitles(layers) {\n    return layers.flatMap((layer) => {\n      if (layer.kind === "text" && layer.role === "subtitle") return [];\n      if (layer.kind === "group") return [{ ...layer, layers: withoutSubtitles(layer.layers) }];\n      if (layer.kind === "transition") {\n        const from = layer.from ? withoutSubtitles([layer.from])[0] ?? null : null;\n        const to = layer.to ? withoutSubtitles([layer.to])[0] ?? null : null;\n        return [{ ...layer, from, to }];\n      }\n      return [layer];\n    });\n  }\n  function createRenderRuntime() {\n    let evaluator;\n    let media;\n    let compositor;\n    let sequenceId = "";\n    let profile;\n    let uploadUrl = "";\n    let rendering = false;\n    const scene = document.createElement("canvas");\n    const output = document.createElement("canvas");\n    const dispose = () => {\n      media?.dispose();\n      compositor?.dispose();\n      media = void 0;\n      compositor = void 0;\n      evaluator = void 0;\n      scene.width = scene.height = output.width = output.height = 1;\n    };\n    return {\n      async initialize(documentValue, id2, settings, urls, endpoint) {\n        if (rendering) throw new Error("上一画面仍在绘制");\n        dispose();\n        profile = validateExportProfile(settings);\n        evaluator = prepareEvaluator(documentValue);\n        evaluator.evaluate(id2, 0);\n        sequenceId = id2;\n        uploadUrl = endpoint;\n        if (new URL(endpoint).origin !== location.origin) throw new Error("渲染输出地址无效");\n        media = new EditorMediaPool({\n          resolveAsset: (assetId) => {\n            const url = urls[assetId];\n            if (!url || new URL(url).origin !== location.origin)\n              throw new Error(`未提供渲染素材：${assetId}`);\n            return url;\n          }\n        });\n        compositor = new FrameCompositor();\n        output.width = profile.width;\n        output.height = profile.height;\n        await document.fonts.ready;\n        return true;\n      },\n      async render(time, requestId) {\n        if (rendering || !evaluator || !media || !compositor || !profile)\n          throw new Error("画面渲染器未就绪或正在工作");\n        if (!Number.isSafeInteger(requestId) || requestId < 0) throw new Error("画面请求编号无效");\n        rendering = true;\n        try {\n          const frame = evaluator.evaluate(sequenceId, time);\n          if (!profile.includeCaptions) frame.layers = withoutSubtitles(frame.layers);\n          const sources = await media.prepare(frame);\n          compositor.draw(scene, frame, sources);\n          const context2 = output.getContext("2d");\n          context2.reset();\n          context2.fillStyle = frame.background;\n          context2.fillRect(0, 0, output.width, output.height);\n          const scale = Math.min(output.width / scene.width, output.height / scene.height);\n          context2.drawImage(\n            scene,\n            (output.width - scene.width * scale) / 2,\n            (output.height - scene.height * scale) / 2,\n            scene.width * scale,\n            scene.height * scale\n          );\n          const blob = await new Promise(\n            (resolve, reject) => output.toBlob(\n              (value) => value ? resolve(value) : reject(new Error("无法编码画面 PNG")),\n              "image/png"\n            )\n          );\n          const response = await fetch(`${uploadUrl}/${requestId}`, {\n            method: "POST",\n            headers: { "Content-Type": "image/png" },\n            body: blob\n          });\n          if (!response.ok) throw new Error("无法传递已完成的画面");\n          return true;\n        } finally {\n          rendering = false;\n        }\n      },\n      dispose\n    };\n  }\n  globalThis.videoStudioRender = createRenderRuntime();\n})();\n';
var sha256 = "e4a351b60cbeb22aed990de000475e83f16ab10451574d1aa1966ae3330a1781";

// native/editor-runtime/cli.ts
import { fileURLToPath } from "node:url";
import { isAbsolute as isAbsolute6 } from "node:path";

// native/editor-runtime/runtime.ts
import { copyFile as copyFile3, link as hardLink, readdir as readdir2, rename as rename4, rm as rm9, stat as stat10 } from "node:fs/promises";
import { randomUUID as randomUUID7 } from "node:crypto";
import { basename as basename3, dirname as dirname6, join as join12 } from "node:path";

// src/external-media.ts
var isResourceId = (id3) => typeof id3 === "string" && /^(?:asset|external)-[a-f0-9]{64}$/.test(id3);

// src/editor/time.ts
var TICKS_PER_SECOND = 24e4;
var MAX_TICK = BigInt(Number.MAX_SAFE_INTEGER);
var SUPPORTED_RATES = /* @__PURE__ */ new Set([
  "24/1",
  "25/1",
  "30/1",
  "48/1",
  "50/1",
  "60/1",
  "24000/1001",
  "30000/1001",
  "60000/1001"
]);
function assertTick(value, label2 = "时间") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label2}必须是非负安全整数刻度`);
  return value;
}
function object(value, label2, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label2}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${label2}必须是普通对象`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new Error(`${label2}包含不支持的字段`);
  return value;
}
function validateFrameRate(value) {
  const data = object(value, "帧率", ["numerator", "denominator"]);
  let numerator = assertTick(data.numerator, "帧率分子");
  let denominator = assertTick(data.denominator, "帧率分母");
  if (!numerator || !denominator) throw new Error("帧率分子和分母必须大于零");
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  if (!SUPPORTED_RATES.has(`${numerator}/${denominator}`)) throw new Error("不支持此工程帧率");
  return { numerator, denominator };
}
function ticksToSeconds(tick2) {
  return assertTick(tick2) / TICKS_PER_SECOND;
}
function frameTicks(rate2) {
  const { numerator, denominator } = validateFrameRate(rate2);
  return TICKS_PER_SECOND * denominator / numerator;
}
function tickFromBigInt(value) {
  if (value < 0n || value > MAX_TICK) throw new Error("时间超过安全整数刻度范围");
  return Number(value);
}
function frameToTicks(frame, rate2) {
  return tickFromBigInt(BigInt(assertTick(frame, "帧序号")) * BigInt(frameTicks(rate2)));
}
function ticksToFrame(tick2, rate2, mode = "round") {
  const value = BigInt(assertTick(tick2));
  const unit = BigInt(frameTicks(rate2));
  if (!["floor", "ceil", "round"].includes(mode)) throw new Error("未知帧取整方式");
  const offset = mode === "ceil" ? unit - 1n : mode === "round" ? unit / 2n : 0n;
  return Number((value + offset) / unit);
}
function validateTimeMap(value, duration, sourceDuration) {
  assertTick(duration, "片段时长");
  assertTick(sourceDuration, "素材时长");
  if (!duration) throw new Error("片段时长必须大于零");
  const data = object(value, "时间映射", ["points"]);
  if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 1e5)
    throw new Error("时间映射需要 2 至 100000 个节点");
  if (Object.getPrototypeOf(data.points) !== Array.prototype || Reflect.ownKeys(data.points).length !== data.points.length + 1)
    throw new Error("时间映射节点必须是连续的普通数组");
  for (let index = 0; index < data.points.length; index++)
    if (!Object.hasOwn(data.points, index)) throw new Error("时间映射节点不能留空");
  let previous = -1;
  const points = data.points.map((raw) => {
    const point = object(raw, "时间映射节点", ["time", "source"]);
    const time2 = assertTick(point.time, "局部时间");
    const source2 = assertTick(point.source, "源时间");
    if (time2 <= previous || time2 > duration) throw new Error("时间映射的局部时间必须严格递增");
    if (source2 > sourceDuration) throw new Error("时间映射超出素材时长");
    previous = time2;
    return { time: time2, source: source2 };
  });
  if (points[0].time !== 0 || points.at(-1).time !== duration)
    throw new Error("时间映射必须覆盖片段的完整时长");
  return { points };
}
function interpolateSource(a, b, time2) {
  const width = BigInt(b.time - a.time);
  const elapsed = BigInt(time2 - a.time);
  const numerator = BigInt(a.source) * (width - elapsed) + BigInt(b.source) * elapsed;
  return tickFromBigInt((2n * numerator + width) / (2n * width));
}
function sourceTimeAt(map, time2) {
  assertTick(time2, "局部时间");
  if (map.points.length < 2) throw new Error("时间映射缺少节点");
  if (time2 <= map.points[0].time) return map.points[0].source;
  if (time2 >= map.points.at(-1).time) return map.points.at(-1).source;
  let left = 0, right = map.points.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (map.points[middle].time <= time2) left = middle;
    else right = middle;
  }
  return interpolateSource(map.points[left], map.points[right], time2);
}
function firstTick(start, end, test) {
  let left = start, right = end;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (test(middle)) right = middle;
    else left = middle + 1;
  }
  return left;
}
function sourceRangesToTimeline(map, start, end) {
  assertTick(start, "源范围入点");
  assertTick(end, "源范围出点");
  if (end < start) throw new Error("源范围出点不能早于入点");
  if (start === end) return [];
  const ranges = [];
  for (let i = 0; i + 1 < map.points.length; i++) {
    const a = map.points[i], b = map.points[i + 1];
    const at = (time2) => interpolateSource(a, b, time2);
    let range;
    if (a.source === b.source) {
      if (a.source < start || a.source >= end) continue;
      range = { start: a.time, end: b.time };
    } else if (b.source > a.source) {
      range = {
        start: firstTick(a.time, b.time, (time2) => at(time2) >= start),
        end: firstTick(a.time, b.time, (time2) => at(time2) >= end)
      };
    } else {
      range = {
        start: firstTick(a.time, b.time, (time2) => at(time2) < end),
        end: firstTick(a.time, b.time, (time2) => at(time2) < start)
      };
    }
    if (range.start >= range.end) continue;
    const previous = ranges.at(-1);
    if (previous?.end === range.start) previous.end = range.end;
    else ranges.push(range);
  }
  return ranges;
}

// src/editor/animation.ts
function finite(value, label2) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label2}必须是有限数`);
  return value;
}
function object2(value, allowed, label2) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label2}必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${label2}必须是普通对象`);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new Error(`${label2}包含不支持的字段`);
  return value;
}
function validateEasing(value) {
  if (typeof value === "string" && ["linear", "hold", "ease-in", "ease-out", "ease-in-out"].includes(value))
    return value;
  const data = object2(value, ["type", "x1", "y1", "x2", "y2"], "关键帧缓动");
  if (data.type !== "cubic-bezier") throw new Error("未知关键帧缓动");
  const result = {
    type: "cubic-bezier",
    x1: finite(data.x1, "贝塞尔 x1"),
    y1: finite(data.y1, "贝塞尔 y1"),
    x2: finite(data.x2, "贝塞尔 x2"),
    y2: finite(data.y2, "贝塞尔 y2")
  };
  if (result.x1 < 0 || result.x1 > 1 || result.x2 < 0 || result.x2 > 1 || result.y1 < -4 || result.y1 > 4 || result.y2 < -4 || result.y2 > 4)
    throw new Error("贝塞尔横轴控制点须在 0–1，纵轴控制点须在 -4–4");
  return result;
}
function validateKeyframes(value, duration) {
  if (duration !== void 0) assertTick(duration, "动画时长");
  if (!Array.isArray(value) || !value.length || value.length > 1e5)
    throw new Error("动画需要 1 至 100000 个关键帧");
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error("关键帧必须是连续的普通数组");
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(value, index)) throw new Error("关键帧不能留空");
  let previous = -1;
  return value.map((raw) => {
    const data = object2(raw, ["time", "value", "easing"], "关键帧");
    const time2 = assertTick(data.time, "关键帧时间");
    if (time2 <= previous || duration !== void 0 && time2 > duration)
      throw new Error("关键帧时间必须严格递增且位于动画时长内");
    previous = time2;
    return {
      time: time2,
      value: finite(data.value, "关键帧数值"),
      ...data.easing === void 0 ? {} : { easing: validateEasing(data.easing) }
    };
  });
}
function validateAnimatedNumber(value, duration) {
  if (duration !== void 0) assertTick(duration, "动画时长");
  if (typeof value === "number") return finite(value, "动画数值");
  const data = object2(value, ["keyframes"], "动画数值");
  return { keyframes: validateKeyframes(data.keyframes, duration) };
}
function cubicFor(easing) {
  if (typeof easing === "object") return easing;
  if (easing === "ease-in") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 1, y2: 1 };
  if (easing === "ease-out") return { type: "cubic-bezier", x1: 0, y1: 0, x2: 0.58, y2: 1 };
  if (easing === "ease-in-out") return { type: "cubic-bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
  return void 0;
}
function coordinate(t, p1, p2) {
  const rest = 1 - t;
  return 3 * rest * rest * t * p1 + 3 * rest * t * t * p2 + t * t * t;
}
function parameterAtX(cubic, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let left = 0, right = 1;
  for (let i = 0; i < 56; i++) {
    const middle = (left + right) / 2;
    if (coordinate(middle, cubic.x1, cubic.x2) < x) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}
function progress(easing, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (easing === "hold") return 0;
  const cubic = cubicFor(easing);
  return cubic ? coordinate(parameterAtX(cubic, x), cubic.y1, cubic.y2) : x;
}
function preceding(keys, time2) {
  let left = 0, right = keys.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (keys[middle].time <= time2) left = middle;
    else right = middle;
  }
  return left;
}
function evaluateAnimatedNumber(value, time2) {
  assertTick(time2, "动画时间");
  if (typeof value === "number") return value;
  const keys = value.keyframes;
  if (!keys.length) throw new Error("动画缺少关键帧");
  if (time2 <= keys[0].time) return keys[0].value;
  if (time2 >= keys.at(-1).time) return keys.at(-1).value;
  const index = preceding(keys, time2), left = keys[index], right = keys[index + 1];
  if (time2 === left.time || left.value === right.value) return left.value;
  const amount = progress(left.easing ?? "linear", (time2 - left.time) / (right.time - left.time));
  return left.value * (1 - amount) + right.value * amount;
}

// src/editor/export-settings.ts
var VIDEO_ENCODERS = {
  h264: "libx264",
  hevc: "libx265",
  vp9: "libvpx-vp9",
  prores: "prores_ks"
};
var AUDIO_ENCODERS = { aac: "aac", opus: "libopus", pcm: "pcm_s16le" };
var PROFILE_KEYS = [
  "id",
  "name",
  "width",
  "height",
  "frameRate",
  "container",
  "videoCodec",
  "audioCodec",
  "quality",
  "audioBitrate",
  "sampleRate",
  "includeCaptions"
];
function object3(value, keys, label2) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`${label2}格式无效或包含未知字段`);
  return value;
}
function integer(value, min, max, label2) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${label2}必须是 ${min}–${max} 范围内的整数`);
  return Number(value);
}
function label(value, max, name) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(`${name}无效`);
  return value;
}
function rate(value) {
  const data = object3(value, ["numerator", "denominator"], "导出帧率");
  return validateFrameRate(data);
}
function validateExportProfile(value) {
  const data = object3(value, PROFILE_KEYS, "导出配置");
  const id3 = label(data.id, 128, "导出配置 ID");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id3)) throw new Error("导出配置 ID 无效");
  const name = label(data.name, 200, "导出配置名称");
  const width = integer(data.width, 16, 8192, "导出宽度");
  const height = integer(data.height, 16, 8192, "导出高度");
  if (width % 2 || height % 2) throw new Error("导出画面宽高必须是偶数");
  const frameRate2 = rate(data.frameRate);
  if (!["mp4", "mov", "webm"].includes(data.container)) throw new Error("不支持此导出容器");
  if (!Object.hasOwn(VIDEO_ENCODERS, data.videoCodec)) throw new Error("不支持此视频编码");
  if (!Object.hasOwn(AUDIO_ENCODERS, data.audioCodec)) throw new Error("不支持此音频编码");
  const container = data.container;
  const videoCodec = data.videoCodec;
  const audioCodec = data.audioCodec;
  const compatible = container === "webm" ? videoCodec === "vp9" && audioCodec === "opus" : container === "mp4" ? ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" : ["h264", "hevc"].includes(videoCodec) && audioCodec === "aac" || videoCodec === "prores" && audioCodec === "pcm";
  if (!compatible) throw new Error("所选容器与音视频编码不兼容");
  const rawQuality = object3(data.quality, ["mode", "value", "bitsPerSecond"], "导出质量");
  let quality;
  if (rawQuality.mode === "quality") {
    if (Object.hasOwn(rawQuality, "bitsPerSecond")) throw new Error("质量模式不能同时指定码率");
    quality = { mode: "quality", value: integer(rawQuality.value, 0, 100, "导出质量") };
  } else if (rawQuality.mode === "bitrate") {
    if (Object.hasOwn(rawQuality, "value")) throw new Error("码率模式不能同时指定质量");
    if (videoCodec === "prores")
      throw new Error("ProRes 请使用质量模式，编码器不支持此目标码率控制");
    quality = {
      mode: "bitrate",
      bitsPerSecond: integer(rawQuality.bitsPerSecond, 1e5, 5e8, "视频目标码率")
    };
  } else throw new Error("导出质量模式无效");
  const audioBitrate = audioCodec === "pcm" ? integer(data.audioBitrate, 1536e3, 1536e3, "PCM 音频码率") : integer(data.audioBitrate, 32e3, audioCodec === "opus" ? 51e4 : 512e3, "音频目标码率");
  if (data.sampleRate !== 48e3) throw new Error("导出音频采样率必须为 48000 Hz");
  if (typeof data.includeCaptions !== "boolean") throw new Error("请明确是否导出字幕");
  return {
    id: id3,
    name,
    width,
    height,
    frameRate: frameRate2,
    container,
    videoCodec,
    audioCodec,
    quality,
    audioBitrate,
    sampleRate: 48e3,
    includeCaptions: data.includeCaptions
  };
}
function requiredExportEncoders(profile) {
  const valid = validateExportProfile(profile);
  return [VIDEO_ENCODERS[valid.videoCodec], AUDIO_ENCODERS[valid.audioCodec]];
}
function assertExportEncodersAvailable(profile, available) {
  const found = new Set(available);
  const missing = requiredExportEncoders(profile).filter((name) => !found.has(name));
  if (missing.length) throw new Error(`当前 FFmpeg 缺少导出编码器：${missing.join("、")}`);
}
function exportEncodingArguments(profile) {
  const p = validateExportProfile(profile);
  const args = [
    "-c:v",
    VIDEO_ENCODERS[p.videoCodec],
    "-pix_fmt",
    p.videoCodec === "prores" ? "yuv422p10le" : "yuv420p",
    "-s:v",
    `${p.width}x${p.height}`,
    "-r",
    `${p.frameRate.numerator}/${p.frameRate.denominator}`,
    "-fps_mode",
    "cfr"
  ];
  if (p.videoCodec === "h264" || p.videoCodec === "hevc") args.push("-preset", "medium");
  if (p.videoCodec === "hevc") args.push("-tag:v", "hvc1");
  if (p.videoCodec === "vp9") args.push("-deadline", "good", "-cpu-used", "2", "-row-mt", "1");
  if (p.videoCodec === "prores") args.push("-profile:v", "3");
  if (p.quality.mode === "bitrate") args.push("-b:v", String(p.quality.bitsPerSecond));
  else if (p.videoCodec === "prores")
    args.push("-qscale:v", String(31 - Math.round(p.quality.value * 30 / 100)));
  else {
    const maximum = p.videoCodec === "vp9" ? 63 : 51;
    args.push("-crf", String(maximum - Math.round(p.quality.value * maximum / 100)));
    if (p.videoCodec === "vp9") args.push("-b:v", "0");
  }
  args.push("-c:a", AUDIO_ENCODERS[p.audioCodec], "-ar", "48000", "-ac", "2");
  if (p.audioCodec !== "pcm") args.push("-b:a", String(p.audioBitrate));
  if (p.container !== "webm") args.push("-movflags", "+faststart");
  args.push("-f", p.container);
  return args;
}
function probeRate(value) {
  if (typeof value !== "string" || !/^\d+(?:\/\d+)?$/.test(value)) return void 0;
  const [num, den = "1"] = value.split("/");
  const number2 = Number(num) / Number(den);
  return Number.isFinite(number2) && number2 > 0 ? number2 : void 0;
}
function probeSeconds(value) {
  if (typeof value !== "string" && typeof value !== "number") return void 0;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return void 0;
  const number2 = Number(value);
  return Number.isFinite(number2) && number2 > 0 ? number2 : void 0;
}
function verifyExportOutput(profile, probe, expectedDurationSeconds) {
  const p = validateExportProfile(profile);
  if (!Number.isFinite(expectedDurationSeconds) || expectedDurationSeconds <= 0 || expectedDurationSeconds > 86400)
    throw new Error("预期成片时长无效");
  if (!probe || typeof probe !== "object" || !Array.isArray(probe.streams))
    throw new Error("导出文件缺少有效的音视频检测结果");
  const value = probe;
  if (value.streams.some((stream) => !stream || typeof stream !== "object" || Array.isArray(stream)))
    throw new Error("导出文件的媒体流信息无效");
  const videos = value.streams.filter(
    (stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic
  );
  const audios = value.streams.filter((stream) => stream.codec_type === "audio");
  if (videos.length !== 1 || audios.length !== 1)
    throw new Error("导出文件必须包含一个画面流和一个混音流");
  const video = videos[0], audio2 = audios[0];
  if (video.codec_name !== p.videoCodec || audio2.codec_name !== (p.audioCodec === "pcm" ? "pcm_s16le" : p.audioCodec))
    throw new Error("导出文件的实际音视频编码与所选配置不一致");
  if (video.width !== p.width || video.height !== p.height)
    throw new Error("导出文件的实际画面尺寸与所选配置不一致");
  if (Number(audio2.sample_rate) !== p.sampleRate || audio2.channels !== 2)
    throw new Error("导出文件的音频采样率或声道数量不正确");
  const expectedRate = p.frameRate.numerator / p.frameRate.denominator;
  const actualRate = probeRate(video.avg_frame_rate) ?? probeRate(video.r_frame_rate);
  if (actualRate === void 0 || Math.abs(actualRate - expectedRate) > 1e-6)
    throw new Error("导出文件的实际帧率与所选配置不一致");
  const durations = [probeSeconds(video.duration), probeSeconds(value.format?.duration)].filter(
    (v) => v !== void 0
  );
  if (!durations.length) throw new Error("导出文件缺少可核验的时长");
  const tolerance = 1 / expectedRate + 1e-6;
  if (durations.some((seconds) => Math.abs(seconds - expectedDurationSeconds) > tolerance))
    throw new Error("导出文件时长与时间线不一致，差异超过一帧");
  const formats = typeof value.format?.format_name === "string" ? value.format.format_name.split(",") : [];
  if (!formats.includes(p.container)) throw new Error("导出文件的实际容器与所选配置不一致");
}

// src/editor/validation.ts
var MAX_EDITOR_TICK = 24 * 60 * 60 * TICKS_PER_SECOND;
var MAX_DOCUMENT_NODES = 1e6;
var MAX_DOCUMENT_CHARACTERS = 16 * 1024 * 1024;
var controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function copyData(value) {
  let nodes = 0, characters = 0;
  const ancestors = /* @__PURE__ */ new Set();
  function visit(item, depth) {
    if (++nodes > MAX_DOCUMENT_NODES || depth > 64) throw new Error("工程结构超过容量限制");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("工程不能包含非有限数字");
      return item;
    }
    if (typeof item === "string") {
      characters += item.length;
      if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
      return item;
    }
    if (!item || typeof item !== "object") throw new Error("工程必须只包含 JSON 数据");
    if (ancestors.has(item)) throw new Error("工程 JSON 数据不能循环引用");
    const array3 = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array3 ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("工程数据必须是普通对象或数组");
    ancestors.add(item);
    try {
      const result = array3 ? [] : {};
      const keys = Reflect.ownKeys(item);
      if (array3 && keys.length !== item.length + 1)
        throw new Error("工程数组不能有空洞或额外属性");
      for (const key of keys) {
        if (array3 && key === "length") continue;
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("工程包含不安全的数据键");
        characters += key.length;
        if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
        if (array3 && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("工程数组包含额外属性");
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor.enumerable || !("value" in descriptor))
          throw new Error("工程不接受隐藏属性或访问器");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  }
  return visit(value, 0);
}
function object4(value, allowed, label2) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label2}必须是对象`);
  const data = value;
  for (const key of Object.keys(data))
    if (!allowed.includes(key)) throw new Error(`${label2}包含未知字段：${key}`);
  return data;
}
function list(value, limit, label2, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > limit)
    throw new Error(`${label2}需要 ${minimum} 至 ${limit} 项`);
  return value;
}
function number(value, min, max, label2) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label2}必须在 ${min} 至 ${max} 之间`);
  return value;
}
function integer2(value, min, max, label2) {
  const result = number(value, min, max, label2);
  if (!Number.isSafeInteger(result)) throw new Error(`${label2}必须是安全整数`);
  return result;
}
function tick(value, label2, positive = false) {
  return integer2(value, positive ? 1 : 0, MAX_EDITOR_TICK, label2);
}
function text(value, max, label2, empty2 = false, multiline = false) {
  if (typeof value !== "string" || value.length > max || !empty2 && !value.trim() || controls.test(value) || !multiline && /[\n\r\t]/.test(value))
    throw new Error(`${label2}文字无效或超过 ${max} 字符`);
  return value;
}
function id(value, label2) {
  const result = text(value, 128, label2);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result)) throw new Error(`${label2}无效`);
  return result;
}
function bool(value, label2) {
  if (typeof value !== "boolean") throw new Error(`${label2}必须是布尔值`);
  return value;
}
function choice(value, allowed, label2) {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label2}无效`);
  return value;
}
function color(value, label2) {
  if (typeof value !== "string" || !(value === "transparent" || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)))
    throw new Error(`${label2}须为十六进制颜色或 transparent`);
  return value;
}
function unique(items, label2) {
  const result = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`${label2} ID 重复：${item.id}`);
    result.set(item.id, item);
  }
  return result;
}
function dataObject(value, label2) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label2}必须是对象`);
  return value;
}
function animated(value, duration, min, max, label2) {
  if (typeof value === "number") return number(value, min, max, label2);
  const data = object4(value, ["keyframes"], label2);
  for (const raw of list(data.keyframes, 1e4, `${label2}关键帧`, 1)) {
    const frame = object4(raw, ["time", "value", "easing"], "关键帧");
    number(frame.value, min, max, label2);
    if (typeof frame.easing === "object")
      object4(frame.easing, ["type", "x1", "y1", "x2", "y2"], "缓动曲线");
  }
  return validateAnimatedNumber(data, duration);
}
function timeMap(value, duration, sourceDuration) {
  const data = object4(value, ["points"], "时间映射");
  for (const point of list(data.points, 1e4, "时间映射节点", 2))
    object4(point, ["time", "source"], "时间映射节点");
  return validateTimeMap(data, duration, sourceDuration);
}
function assertNoEmptyHold(map, sourceDuration, label2) {
  if (map.points.some(
    (point, index) => index > 0 && point.source === sourceDuration && map.points[index - 1].source === sourceDuration
  ))
    throw new Error(`${label2}不能在素材结束边界定格`);
}
function transform(value, duration) {
  const data = object4(
    value,
    ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "flipX", "flipY", "fit", "crop"],
    "构图"
  );
  const crop = object4(data.crop, ["left", "top", "right", "bottom"], "裁切");
  const bounds = {
    left: number(crop.left, 0, 1, "左裁切"),
    top: number(crop.top, 0, 1, "上裁切"),
    right: number(crop.right, 0, 1, "右裁切"),
    bottom: number(crop.bottom, 0, 1, "下裁切")
  };
  if (bounds.left + bounds.right >= 1 || bounds.top + bounds.bottom >= 1)
    throw new Error("裁切后必须保留有效画面");
  return {
    x: animated(data.x, duration, -10, 10, "水平位置"),
    y: animated(data.y, duration, -10, 10, "垂直位置"),
    scaleX: animated(data.scaleX, duration, 0, 100, "水平缩放"),
    scaleY: animated(data.scaleY, duration, 0, 100, "垂直缩放"),
    rotation: animated(data.rotation, duration, -36e4, 36e4, "旋转"),
    opacity: animated(data.opacity, duration, 0, 1, "不透明度"),
    flipX: bool(data.flipX, "水平翻转"),
    flipY: bool(data.flipY, "垂直翻转"),
    fit: choice(data.fit, ["contain", "cover", "stretch"], "画面适配"),
    crop: bounds
  };
}
function adjustment(value, duration) {
  const data = object4(
    value,
    [
      "exposure",
      "brightness",
      "contrast",
      "saturation",
      "temperature",
      "tint",
      "hue",
      "curves",
      "hsl"
    ],
    "调色"
  );
  const channels = /* @__PURE__ */ new Set();
  const curves = list(data.curves, 4, "调色曲线").map((raw) => {
    const curve = object4(raw, ["channel", "points"], "调色曲线");
    const channel = choice(curve.channel, ["rgb", "red", "green", "blue"], "曲线通道");
    if (channels.has(channel)) throw new Error("调色曲线通道重复");
    channels.add(channel);
    let last = -1;
    const points = list(curve.points, 256, "曲线节点", 2).map((entry) => {
      const point = object4(entry, ["x", "y"], "曲线节点");
      const x = number(point.x, 0, 1, "曲线输入"), y = number(point.y, 0, 1, "曲线输出");
      if (x <= last) throw new Error("调色曲线输入必须严格递增");
      last = x;
      return { x, y };
    });
    if (points[0].x !== 0 || points.at(-1).x !== 1) throw new Error("调色曲线必须覆盖 0 至 1");
    return { channel, points };
  });
  const hsl = list(data.hsl, 24, "HSL 调整").map((raw) => {
    const band = object4(raw, ["hue", "width", "hueShift", "saturation", "lightness"], "HSL 调整");
    return {
      hue: number(band.hue, 0, 360, "HSL 色相"),
      width: number(band.width, 1e-3, 360, "HSL 范围"),
      hueShift: number(band.hueShift, -180, 180, "HSL 色相偏移"),
      saturation: number(band.saturation, -1, 1, "HSL 饱和度"),
      lightness: number(band.lightness, -1, 1, "HSL 明度")
    };
  });
  return {
    exposure: animated(data.exposure, duration, -10, 10, "曝光"),
    brightness: animated(data.brightness, duration, -1, 1, "亮度"),
    contrast: animated(data.contrast, duration, 0, 4, "对比度"),
    saturation: animated(data.saturation, duration, 0, 4, "饱和度"),
    temperature: animated(data.temperature, duration, -1, 1, "色温"),
    tint: animated(data.tint, duration, -1, 1, "色调"),
    hue: animated(data.hue, duration, -360, 360, "色相"),
    curves,
    hsl
  };
}
function mask(value) {
  const data = object4(
    value,
    ["kind", "x", "y", "width", "height", "rotation", "feather", "inverted", "points"],
    "蒙版"
  );
  const kind = choice(data.kind, ["rectangle", "ellipse", "linear", "path"], "蒙版类型");
  let points;
  if (kind === "path") {
    points = list(data.points, 256, "蒙版顶点", 3).map((raw) => {
      const point = object4(raw, ["x", "y"], "蒙版顶点");
      return { x: number(point.x, 0, 1, "蒙版顶点 x"), y: number(point.y, 0, 1, "蒙版顶点 y") };
    });
    if (new Set(points.map((point) => `${point.x}:${point.y}`)).size < 3)
      throw new Error("路径蒙版至少需要三个不同顶点");
  } else if (data.points !== void 0) throw new Error("只有路径蒙版可以保存顶点");
  return {
    kind,
    x: number(data.x, -2, 2, "蒙版 x"),
    y: number(data.y, -2, 2, "蒙版 y"),
    width: number(data.width, 1e-3, 4, "蒙版宽度"),
    height: number(data.height, 1e-3, 4, "蒙版高度"),
    rotation: number(data.rotation, -36e4, 36e4, "蒙版旋转"),
    feather: number(data.feather, 0, 1, "蒙版羽化"),
    inverted: bool(data.inverted, "蒙版反转"),
    ...points ? { points } : {}
  };
}
function visual(data, duration) {
  return {
    transform: transform(data.transform, duration),
    color: adjustment(data.color, duration),
    blendMode: choice(
      data.blendMode,
      ["normal", "multiply", "screen", "overlay", "darken", "lighten"],
      "混合模式"
    ),
    ...data.mask === void 0 ? {} : { mask: mask(data.mask) }
  };
}
function audio(value, duration) {
  const data = object4(
    value,
    ["volume", "pan", "fadeIn", "fadeOut", "pitchSemitones", "preservePitch", "ducking"],
    "音频混音"
  );
  let ducking;
  if (data.ducking !== void 0) {
    const sidechain = object4(
      data.ducking,
      ["sidechainTrackIds", "thresholdDb", "attenuationDb", "attack", "release"],
      "自动压低背景声"
    );
    const sidechainTrackIds = list(sidechain.sidechainTrackIds, 64, "参考音轨", 1).map(
      (value2) => id(value2, "参考音轨 ID")
    );
    if (new Set(sidechainTrackIds).size !== sidechainTrackIds.length)
      throw new Error("参考音轨重复");
    ducking = {
      sidechainTrackIds,
      thresholdDb: number(sidechain.thresholdDb, -96, 0, "压低触发电平"),
      attenuationDb: number(sidechain.attenuationDb, 0, 60, "压低分贝"),
      attack: integer2(sidechain.attack, 0, TICKS_PER_SECOND * 10, "压低启动时间"),
      release: integer2(sidechain.release, 0, TICKS_PER_SECOND * 30, "压低恢复时间")
    };
  }
  return {
    volume: animated(data.volume, duration, 0, 4, "音量"),
    pan: animated(data.pan, duration, -1, 1, "声像"),
    fadeIn: integer2(data.fadeIn, 0, duration, "声音淡入"),
    fadeOut: integer2(data.fadeOut, 0, duration, "声音淡出"),
    pitchSemitones: number(data.pitchSemitones, -24, 24, "音高"),
    preservePitch: bool(data.preservePitch, "保持音高"),
    ...ducking ? { ducking } : {}
  };
}
function textStyle(value) {
  const data = object4(
    value,
    [
      "layout",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "italic",
      "color",
      "strokeColor",
      "strokeWidth",
      "background",
      "backgroundRadius",
      "padding",
      "align",
      "lineHeight",
      "letterSpacing",
      "maxWidth",
      "highlightColor",
      "keywords",
      "shadow",
      "animation"
    ],
    "文字样式"
  );
  const shadow = object4(data.shadow, ["color", "blur", "x", "y"], "文字阴影");
  return {
    layout: choice(data.layout, ["box", "caption-stack"], "文字布局"),
    fontFamily: text(data.fontFamily, 200, "字体"),
    fontSize: number(data.fontSize, 1, 2048, "字号"),
    fontWeight: integer2(data.fontWeight, 1, 1e3, "字重"),
    italic: bool(data.italic, "斜体"),
    color: color(data.color, "文字颜色"),
    strokeColor: color(data.strokeColor, "文字描边颜色"),
    strokeWidth: number(data.strokeWidth, 0, 100, "文字描边宽度"),
    background: color(data.background, "文字背景"),
    backgroundRadius: number(data.backgroundRadius, 0, 512, "文字背景圆角"),
    padding: number(data.padding, 0, 512, "文字背景内边距"),
    align: choice(data.align, ["left", "center", "right"], "文字对齐"),
    lineHeight: number(data.lineHeight, 0.5, 5, "文字行高"),
    letterSpacing: number(data.letterSpacing, -100, 100, "字间距"),
    maxWidth: number(data.maxWidth, 0.01, 1, "文字最大宽度比例"),
    highlightColor: color(data.highlightColor, "文字高亮颜色"),
    ...data.keywords === void 0 ? {} : {
      keywords: list(data.keywords, 32, "关键词强调").map((value2) => {
        const keyword = object4(value2, ["text", "color"], "关键词强调");
        return {
          text: text(keyword.text, 200, "关键词"),
          color: color(keyword.color, "关键词颜色")
        };
      })
    },
    shadow: {
      color: color(shadow.color, "文字阴影颜色"),
      blur: number(shadow.blur, 0, 256, "文字阴影模糊"),
      x: number(shadow.x, -2048, 2048, "文字阴影水平偏移"),
      y: number(shadow.y, -2048, 2048, "文字阴影垂直偏移")
    },
    animation: choice(data.animation, ["none", "fade", "typewriter", "word-highlight"], "文字动画")
  };
}
function asset(value) {
  const data = object4(
    value,
    ["id", "name", "kind", "duration", "width", "height", "resourceId", "fingerprint", "metadata"],
    "素材"
  );
  const kind = choice(data.kind, ["video", "audio", "image", "demo"], "素材类型");
  let resourceId2;
  if (data.resourceId !== void 0) {
    resourceId2 = text(data.resourceId, 256, "素材资源 ID");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(resourceId2))
      throw new Error("素材资源 ID 无效");
  }
  if (data.fingerprint !== void 0 && (typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)))
    throw new Error("素材指纹须为 SHA-256");
  return {
    id: id(data.id, "素材 ID"),
    name: text(data.name, 256, "素材名称"),
    kind,
    duration: tick(data.duration, "素材时长", kind !== "image"),
    ...data.width === void 0 ? {} : { width: integer2(data.width, 1, 32768, "素材宽度") },
    ...data.height === void 0 ? {} : { height: integer2(data.height, 1, 32768, "素材高度") },
    ...resourceId2 === void 0 ? {} : { resourceId: resourceId2 },
    ...data.fingerprint === void 0 ? {} : { fingerprint: data.fingerprint },
    ...data.metadata === void 0 ? {} : { metadata: dataObject(data.metadata, "素材元数据") }
  };
}
function track(value) {
  const data = object4(
    value,
    ["id", "name", "kind", "locked", "hidden", "muted", "volume", "pan"],
    "轨道"
  );
  return {
    id: id(data.id, "轨道 ID"),
    name: text(data.name, 200, "轨道名称"),
    kind: choice(data.kind, ["video", "audio", "text"], "轨道类型"),
    locked: bool(data.locked, "锁定轨道"),
    hidden: bool(data.hidden, "隐藏轨道"),
    muted: bool(data.muted, "静音轨道"),
    volume: number(data.volume, 0, 4, "轨道音量"),
    pan: number(data.pan, -1, 1, "轨道声像")
  };
}
var clipKeys = [
  "id",
  "kind",
  "trackId",
  "start",
  "duration",
  "label",
  "groupId",
  "linkGroupId",
  "transform",
  "color",
  "blendMode",
  "mask"
];
function clip(value, assets) {
  const raw = object4(
    value,
    [
      ...clipKeys,
      "assetId",
      "timeMap",
      "audio",
      "role",
      "text",
      "style",
      "words",
      "sourceBinding",
      "translation",
      "shape",
      "fill",
      "stroke",
      "strokeWidth",
      "sequenceId",
      "angles",
      "switches",
      "audioAngleId"
    ],
    "片段"
  );
  const kind = choice(raw.kind, ["media", "text", "shape", "sequence", "multicam"], "片段类型");
  const keys = {
    media: ["assetId", "timeMap", "audio"],
    text: ["role", "text", "style", "words", "sourceBinding", "translation"],
    shape: ["shape", "fill", "stroke", "strokeWidth"],
    sequence: ["sequenceId", "timeMap", "audio"],
    multicam: ["timeMap", "angles", "switches", "audioAngleId", "audio"]
  };
  const data = object4(raw, [...clipKeys, ...keys[kind]], "片段");
  const start = tick(data.start, "片段起点"), duration = tick(data.duration, "片段时长", true);
  if (start + duration > MAX_EDITOR_TICK) throw new Error("片段末端超过 24 小时");
  const base = {
    id: id(data.id, "片段 ID"),
    trackId: id(data.trackId, "片段轨道 ID"),
    start,
    duration,
    label: text(data.label, 256, "片段名称", true),
    ...data.groupId === void 0 ? {} : { groupId: id(data.groupId, "分组 ID") },
    ...data.linkGroupId === void 0 ? {} : { linkGroupId: id(data.linkGroupId, "关联组 ID") },
    ...visual(data, duration)
  };
  if (kind === "media") {
    const assetId = id(data.assetId, "片段素材 ID"), source2 = assets.get(assetId);
    if (!source2) throw new Error(`片段引用不存在的素材：${assetId}`);
    const mapping = timeMap(data.timeMap, duration, source2.duration);
    if (source2.kind !== "image") assertNoEmptyHold(mapping, source2.duration, "媒体片段");
    return { ...base, kind, assetId, timeMap: mapping, audio: audio(data.audio, duration) };
  }
  if (kind === "sequence")
    return {
      ...base,
      kind,
      sequenceId: id(data.sequenceId, "嵌套序列 ID"),
      timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
      audio: audio(data.audio, duration)
    };
  if (kind === "shape")
    return {
      ...base,
      kind,
      shape: choice(data.shape, ["rectangle", "ellipse", "line"], "图形类型"),
      fill: color(data.fill, "图形填充"),
      stroke: color(data.stroke, "图形描边"),
      strokeWidth: number(data.strokeWidth, 0, 1024, "图形描边宽度")
    };
  if (kind === "multicam") {
    const angles = list(data.angles, 32, "多机位", 2).map((raw2) => {
      const angle = object4(raw2, ["id", "name", "assetId", "offset"], "机位");
      const assetId = id(angle.assetId, "机位素材 ID");
      if (assets.get(assetId)?.kind !== "video") throw new Error("多机位须引用有效的视频素材");
      return {
        id: id(angle.id, "机位 ID"),
        name: text(angle.name, 200, "机位名称"),
        assetId,
        offset: integer2(angle.offset, -MAX_EDITOR_TICK, MAX_EDITOR_TICK, "机位同步偏移")
      };
    });
    const anglesById = unique(angles, "机位");
    let previous = -1;
    const switches = list(data.switches, 1e4, "机位切换", 1).map((raw2) => {
      const change = object4(raw2, ["time", "angleId"], "机位切换");
      const time2 = integer2(change.time, 0, duration - 1, "机位切换时间");
      if (time2 <= previous) throw new Error("机位切换时间必须严格递增");
      previous = time2;
      const angleId = id(change.angleId, "切换机位 ID");
      if (!anglesById.has(angleId)) throw new Error("切换引用不存在的机位");
      return { time: time2, angleId };
    });
    if (switches[0].time !== 0) throw new Error("多机位须从零时刻指定画面");
    const audioAngleId = id(data.audioAngleId, "主声音机位 ID");
    if (!anglesById.has(audioAngleId)) throw new Error("主声音引用不存在的机位");
    return {
      ...base,
      kind,
      timeMap: timeMap(data.timeMap, duration, MAX_EDITOR_TICK),
      angles,
      switches,
      audioAngleId,
      audio: audio(data.audio, duration)
    };
  }
  let previousStart = -1, previousEnd = -1;
  const words = list(data.words, 1e4, "逐字字幕").map((raw2) => {
    const word = object4(raw2, ["text", "start", "end"], "字幕词");
    const start2 = integer2(word.start, 0, duration - 1, "字幕词入点");
    const end = integer2(word.end, start2 + 1, duration, "字幕词出点");
    if (start2 < previousStart || end < previousEnd) throw new Error("字幕词时间必须按顺序排列");
    previousStart = start2;
    previousEnd = end;
    return { text: text(word.text, 1e3, "字幕词"), start: start2, end };
  });
  let sourceBinding;
  if (data.sourceBinding !== void 0) {
    const binding = object4(
      data.sourceBinding,
      ["clipId", "sourceStart", "sourceEnd", "provenance"],
      "字幕来源"
    );
    const sourceStart = tick(binding.sourceStart, "字幕源入点"), sourceEnd = tick(binding.sourceEnd, "字幕源出点");
    if (sourceEnd <= sourceStart) throw new Error("字幕来源须有有效时长");
    sourceBinding = { clipId: id(binding.clipId, "字幕来源片段 ID"), sourceStart, sourceEnd };
    if (binding.provenance !== void 0) {
      const raw2 = object4(binding.provenance, ["path", "assetId", "start", "end"], "字幕实际音源");
      const start2 = tick(raw2.start, "转写素材入点"), end = tick(raw2.end, "转写素材出点");
      if (end <= start2) throw new Error("字幕实际音源须有正时长");
      sourceBinding.provenance = {
        path: list(raw2.path, 50, "嵌套音源路径").map((value2) => id(value2, "嵌套来源片段 ID")),
        assetId: id(raw2.assetId, "转写素材 ID"),
        start: start2,
        end
      };
    }
  }
  let translation;
  if (data.translation !== void 0) {
    const translated = object4(
      data.translation,
      ["original", "language", "mode", "originalWords"],
      "字幕翻译"
    );
    translation = {
      original: text(translated.original, 1e4, "字幕原文", false, true),
      language: text(translated.language, 80, "字幕语言"),
      mode: choice(translated.mode, ["bilingual", "translated"], "字幕翻译模式")
    };
    if (translated.originalWords !== void 0) {
      let previousStart2 = -1, previousEnd2 = -1;
      translation.originalWords = list(translated.originalWords, 1e4, "字幕原文词时间").map(
        (raw2) => {
          const word = object4(raw2, ["text", "start", "end"], "原文词");
          const start2 = integer2(word.start, 0, duration - 1, "原文词入点"), end = integer2(word.end, start2 + 1, duration, "原文词出点");
          if (start2 < previousStart2 || end < previousEnd2)
            throw new Error("原文词时间必须按顺序排列");
          previousStart2 = start2;
          previousEnd2 = end;
          return { text: text(word.text, 1e3, "原文词"), start: start2, end };
        }
      );
    }
  }
  return {
    ...base,
    kind: "text",
    role: choice(data.role, ["title", "subtitle"], "文字用途"),
    text: text(data.text, 1e4, "文字内容", true, true),
    style: textStyle(data.style),
    words,
    ...sourceBinding ? { sourceBinding } : {},
    ...translation ? { translation } : {}
  };
}
function sequenceDuration(sequence2) {
  let duration = 0;
  for (const clip2 of sequence2.clips) {
    const end = tick(clip2.start, "片段起点") + tick(clip2.duration, "片段时长", true);
    if (end > MAX_EDITOR_TICK) throw new Error("序列超过 24 小时");
    duration = Math.max(duration, end);
  }
  return duration;
}
function sequence(value, assets) {
  const data = object4(
    value,
    [
      "id",
      "name",
      "width",
      "height",
      "frameRate",
      "background",
      "timelineMode",
      "magneticTrackId",
      "tracks",
      "clips",
      "transitions",
      "markers"
    ],
    "序列"
  );
  object4(data.frameRate, ["numerator", "denominator"], "序列帧率");
  const tracks = list(data.tracks, 128, "轨道").map(track);
  unique(tracks, "轨道");
  const magneticTrackId = data.magneticTrackId === void 0 ? void 0 : id(data.magneticTrackId, "磁吸主轨 ID");
  if (magneticTrackId !== void 0 && !tracks.some((track2) => track2.id === magneticTrackId && track2.kind === "video"))
    throw new Error("磁吸主轨必须引用现有画面轨");
  const clips = list(data.clips, 2e3, "片段").map((value2) => clip(value2, assets));
  unique(clips, "片段");
  const transitions = list(data.transitions, 2e3, "转场").map((raw) => {
    const transition = object4(
      raw,
      ["id", "fromClipId", "toClipId", "start", "duration", "kind"],
      "转场"
    );
    const start = tick(transition.start, "转场起点"), duration = tick(transition.duration, "转场时长", true);
    if (start + duration > MAX_EDITOR_TICK) throw new Error("转场超过 24 小时");
    return {
      id: id(transition.id, "转场 ID"),
      fromClipId: id(transition.fromClipId, "转场起始片段"),
      toClipId: id(transition.toClipId, "转场结束片段"),
      start,
      duration,
      kind: choice(
        transition.kind,
        ["dissolve", "fade-black", "wipe-left", "wipe-right", "push-left", "push-right"],
        "转场类型"
      )
    };
  });
  unique(transitions, "转场");
  const markers = list(data.markers, 1e4, "时间轴标记").map((raw) => {
    const marker = object4(raw, ["id", "time", "duration", "name", "note", "color"], "时间轴标记");
    const time2 = tick(marker.time, "标记时间"), duration = tick(marker.duration, "标记范围");
    if (time2 + duration > MAX_EDITOR_TICK) throw new Error("标记范围超过 24 小时");
    return {
      id: id(marker.id, "标记 ID"),
      time: time2,
      duration,
      name: text(marker.name, 200, "标记名称"),
      note: text(marker.note, 1e4, "标记备注", true, true),
      color: color(marker.color, "标记颜色")
    };
  });
  unique(markers, "标记");
  return {
    id: id(data.id, "序列 ID"),
    name: text(data.name, 200, "序列名称"),
    width: integer2(data.width, 16, 8192, "序列宽度"),
    height: integer2(data.height, 16, 8192, "序列高度"),
    frameRate: validateFrameRate(data.frameRate),
    background: color(data.background, "序列背景"),
    timelineMode: choice(data.timelineMode, ["magnetic", "free"], "排列方式"),
    ...magneticTrackId === void 0 ? {} : { magneticTrackId },
    tracks,
    clips,
    transitions,
    markers
  };
}
function compatibleTrack(clip2, track2, assets) {
  if (clip2.kind === "text") return track2.kind === "text";
  if (clip2.kind === "shape" || clip2.kind === "multicam") return track2.kind === "video";
  if (clip2.kind === "sequence") return track2.kind !== "text";
  const source2 = assets.get(clip2.assetId);
  return source2.kind === "audio" ? track2.kind === "audio" : source2.kind === "video" ? track2.kind !== "text" : track2.kind === "video";
}
function multicamBounds(clip2, assets) {
  const angles = new Map(clip2.angles.map((angle) => [angle.id, angle]));
  function range(angleId, start, end) {
    const angle = angles.get(angleId), source2 = assets.get(angle.assetId);
    const coordinates = [
      sourceTimeAt(clip2.timeMap, start),
      ...clip2.timeMap.points.filter((point) => point.time > start && point.time < end).map((point) => point.source),
      sourceTimeAt(clip2.timeMap, end)
    ];
    if (coordinates.some(
      (position) => position + angle.offset < 0 || position + angle.offset > source2.duration
    ))
      throw new Error(`机位 ${angle.name} 的画面或声音范围超出素材`);
    if (coordinates.some(
      (position, index) => index > 0 && position + angle.offset === source2.duration && coordinates[index - 1] + angle.offset === source2.duration
    ))
      throw new Error(`机位 ${angle.name} 不能在素材结束边界定格`);
  }
  for (const [index, change] of clip2.switches.entries())
    range(change.angleId, change.time, clip2.switches[index + 1]?.time ?? clip2.duration);
  const volume = clip2.audio.volume;
  if (typeof volume === "number" ? volume > 0 : volume.keyframes.some((frame) => frame.value > 0))
    range(clip2.audioAngleId, 0, clip2.duration);
}
function checkSequenceReferences(sequence2, assets, sequences) {
  const tracks = new Map(sequence2.tracks.map((track2) => [track2.id, track2]));
  const clips = new Map(sequence2.clips.map((clip2) => [clip2.id, clip2]));
  for (const clip2 of sequence2.clips) {
    const track2 = tracks.get(clip2.trackId);
    if (!track2) throw new Error(`片段引用不存在的轨道：${clip2.trackId}`);
    if (!compatibleTrack(clip2, track2, assets)) throw new Error(`片段 ${clip2.id} 与轨道类型不兼容`);
    if (clip2.kind === "sequence") {
      const source2 = sequences.get(clip2.sequenceId);
      if (!source2) throw new Error(`嵌套引用不存在的序列：${clip2.sequenceId}`);
      const sourceDuration = sequenceDuration(source2);
      if (!sourceDuration) throw new Error("嵌套片段不能引用空序列");
      validateTimeMap(clip2.timeMap, clip2.duration, sourceDuration);
      assertNoEmptyHold(clip2.timeMap, sourceDuration, "嵌套片段");
    }
    if (clip2.kind === "multicam") multicamBounds(clip2, assets);
    if ("audio" in clip2 && clip2.audio.ducking)
      for (const trackId of clip2.audio.ducking.sidechainTrackIds) {
        const source2 = tracks.get(trackId);
        if (!source2 || source2.kind === "text" || source2.id === clip2.trackId)
          throw new Error("压低背景声须引用其他有效声音轨道");
      }
    if (clip2.kind === "text" && clip2.sourceBinding) {
      const binding = clip2.sourceBinding, source2 = clips.get(binding.clipId);
      if (!source2 || !("timeMap" in source2)) throw new Error("字幕来源须引用有效的媒体或序列片段");
      const sourceSequence = source2.kind === "sequence" ? sequences.get(source2.sequenceId) : void 0;
      if (source2.kind === "sequence" && !sourceSequence)
        throw new Error("字幕来源引用不存在的嵌套序列");
      const sourceDuration = source2.kind === "media" ? assets.get(source2.assetId).duration : source2.kind === "sequence" ? sequenceDuration(sourceSequence) : MAX_EDITOR_TICK;
      if (binding.sourceEnd > sourceDuration) throw new Error("字幕来源范围超出素材");
      if (binding.provenance) {
        let leaf = source2;
        for (const clipId of binding.provenance.path) {
          if (leaf.kind !== "sequence") throw new Error("字幕嵌套音源路径须经过序列片段");
          const child = sequences.get(leaf.sequenceId)?.clips.find((item) => item.id === clipId);
          if (!child || !("timeMap" in child)) throw new Error("字幕嵌套音源不存在");
          leaf = child;
        }
        const assetId = leaf.kind === "media" ? leaf.assetId : leaf.kind === "multicam" ? leaf.angles.find((angle) => angle.id === leaf.audioAngleId)?.assetId : void 0;
        const asset2 = assets.get(binding.provenance.assetId);
        if (assetId !== binding.provenance.assetId || !asset2 || !["audio", "video"].includes(asset2.kind) || binding.provenance.end > asset2.duration)
          throw new Error("字幕实际音源或转写范围与来源片段不一致");
      }
    }
  }
  const pairs = /* @__PURE__ */ new Set();
  for (const transition of sequence2.transitions) {
    const from = clips.get(transition.fromClipId), to = clips.get(transition.toClipId);
    if (!from || !to || from.id === to.id || from.trackId !== to.trackId || tracks.get(from.trackId)?.kind !== "video")
      throw new Error("转场两端须为同一画面轨的两个有效片段");
    const end = from.start + from.duration;
    if (from.start >= to.start || end >= to.start + to.duration || to.start >= end || transition.start !== to.start || transition.duration !== end - to.start)
      throw new Error("转场时间须精确覆盖前后片段的重叠范围");
    const key = JSON.stringify([from.id, to.id]);
    if (pairs.has(key)) throw new Error("同一片段交界不能重复设置转场");
    pairs.add(key);
  }
  for (const track2 of sequence2.tracks.filter((track3) => track3.kind === "video")) {
    const placed = sequence2.clips.filter((clip2) => clip2.trackId === track2.id).sort((a, b) => a.start - b.start || a.duration - b.duration);
    let active = [];
    for (const clip2 of placed) {
      active = active.filter((previous) => previous.start + previous.duration > clip2.start);
      if (active.length > 1) throw new Error("同一画面轨不能同时重叠三个片段");
      for (const previous of active)
        if (!pairs.has(JSON.stringify([previous.id, clip2.id])))
          throw new Error("同轨画面重叠需要明确的转场");
      active.push(clip2);
    }
  }
}
function validateEditorDocument(value) {
  const data = object4(
    copyData(value),
    [
      "schemaVersion",
      "timebase",
      "id",
      "name",
      "revision",
      "assets",
      "sequences",
      "activeSequenceId",
      "exportProfiles",
      "production"
    ],
    "工程"
  );
  if (data.schemaVersion !== 2 || data.timebase !== TICKS_PER_SECOND)
    throw new Error("不支持此工程版本或时间基准");
  const assets = list(data.assets, 1e3, "素材").map(asset), assetsById = unique(assets, "素材");
  const sequences = list(data.sequences, 50, "序列", 1).map((value2) => sequence(value2, assetsById));
  const sequencesById = unique(sequences, "序列");
  const activeSequenceId = id(data.activeSequenceId, "活动序列 ID");
  if (!sequencesById.has(activeSequenceId)) throw new Error("活动序列不存在");
  for (const sequence2 of sequences) checkSequenceReferences(sequence2, assetsById, sequencesById);
  const visiting = /* @__PURE__ */ new Set(), visited = /* @__PURE__ */ new Set();
  function acyclic(id3) {
    if (visiting.has(id3)) throw new Error("嵌套序列不能循环引用");
    if (visited.has(id3)) return;
    visiting.add(id3);
    for (const clip2 of sequencesById.get(id3).clips)
      if (clip2.kind === "sequence") acyclic(clip2.sequenceId);
    visiting.delete(id3);
    visited.add(id3);
  }
  for (const sequence2 of sequences) acyclic(sequence2.id);
  const exportProfiles = list(data.exportProfiles, 64, "导出配置").map(validateExportProfile);
  unique(exportProfiles, "导出配置");
  return {
    schemaVersion: 2,
    timebase: TICKS_PER_SECOND,
    id: id(data.id, "工程 ID"),
    name: text(data.name, 200, "工程名称"),
    revision: integer2(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, "修订号"),
    assets,
    sequences,
    activeSequenceId,
    exportProfiles,
    ...data.production === void 0 ? {} : { production: dataObject(data.production, "制作记录") }
  };
}

// src/editor/portable-project.ts
var PORTABLE_PROJECT_FORMAT = "mimi-video-project";
var PORTABLE_PROJECT_VERSION = 1;
var MAX_PORTABLE_MEDIA = 1e4;
var PortableProjectError = class extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.code = code;
    this.issues = issues;
    this.name = "PortableProjectError";
  }
  code;
  issues;
};
var invalid = (message) => {
  throw new PortableProjectError("INVALID_BUNDLE", message);
};
function object5(value, keys, label2) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label2}必须是对象`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid(`${label2}必须是普通对象`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key)))
    invalid(`${label2}字段缺失或不支持`);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !keys.includes(key) || !descriptor.enumerable || !("value" in descriptor))
      invalid(`${label2}不能包含额外字段或访问器`);
  }
  return value;
}
function array(value, label2, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > MAX_PORTABLE_MEDIA)
    invalid(`${label2}项数无效（最多 ${MAX_PORTABLE_MEDIA}）`);
  const list2 = value;
  if (Reflect.ownKeys(list2).length !== list2.length + 1) invalid(`${label2}不能有空洞或额外属性`);
  for (let i = 0; i < list2.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(list2, String(i));
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(`${label2}不能有空洞或访问器`);
  }
  return list2;
}
function portableMediaPath(sha2562) {
  if (typeof sha2562 !== "string" || !/^[a-f0-9]{64}$/.test(sha2562)) invalid("素材 SHA-256 无效");
  return `media/${sha2562}`;
}
function validatePortableProjectManifest(value) {
  const data = object5(value, ["format", "formatVersion", "document", "media"], "工程包清单");
  if (data.format !== PORTABLE_PROJECT_FORMAT) invalid("不是 Mimi 视频工程包");
  if (data.formatVersion !== PORTABLE_PROJECT_VERSION)
    throw new PortableProjectError(
      "UNSUPPORTED_BUNDLE_VERSION",
      `不支持的工程包版本：${String(data.formatVersion)}`
    );
  const document2 = validateEditorDocument(data.document);
  if (document2.assets.length > MAX_PORTABLE_MEDIA)
    invalid(`工程最多包含 ${MAX_PORTABLE_MEDIA} 个素材`);
  const assets = new Map(document2.assets.map((asset2) => [asset2.id, asset2]));
  const hashes = /* @__PURE__ */ new Set(), bound = /* @__PURE__ */ new Set();
  const media = array(data.media, "素材清单").map((value2) => {
    const item = object5(value2, ["sha256", "bytes", "assetIds"], "素材记录");
    portableMediaPath(item.sha256);
    const sha2562 = item.sha256;
    if (hashes.has(sha2562)) invalid(`素材摘要重复：${sha2562}`);
    hashes.add(sha2562);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1)
      invalid("素材大小必须是正整数");
    const assetIds = array(item.assetIds, "素材引用", 1).map((id3) => {
      if (typeof id3 !== "string") invalid("素材引用必须是 ID");
      const asset2 = assets.get(id3);
      if (!asset2 || asset2.kind === "demo" || bound.has(id3))
        invalid(`素材引用无效或重复：${String(id3)}`);
      if (asset2.fingerprint && asset2.fingerprint !== sha2562)
        invalid(`素材摘要与工程不一致：${id3}`);
      bound.add(id3);
      return id3;
    });
    return { sha256: sha2562, bytes: item.bytes, assetIds };
  });
  const missing = document2.assets.filter((asset2) => asset2.kind !== "demo" && !bound.has(asset2.id));
  if (missing.length)
    throw new PortableProjectError(
      "MISSING_MEDIA",
      "工程包没有包含全部原始素材",
      missing.map((asset2) => ({ assetId: asset2.id, message: `缺少素材：${asset2.name}` }))
    );
  return {
    format: PORTABLE_PROJECT_FORMAT,
    formatVersion: PORTABLE_PROJECT_VERSION,
    document: document2,
    media
  };
}

// src/editor/waveform.ts
var WAVEFORM_LIMITS = Object.freeze({
  bins: 65536,
  bytes: 768 * 1024,
  sampleRate: 48e3,
  seconds: 86400
});
function decodeEditorWaveform(value) {
  const v = value;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== "channels,hasAudio,peakScale,peaksBase64,sampleCount,sampleRate,samplesPerBin,schemaVersion,sourceHash" || v.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(v.sourceHash) || v.sampleRate !== 48e3 || v.channels !== 2 || typeof v.hasAudio !== "boolean" || !Number.isSafeInteger(v.sampleCount) || v.sampleCount < 0 || v.sampleCount > WAVEFORM_LIMITS.seconds * 48e3 || !Number.isSafeInteger(v.samplesPerBin) || v.samplesPerBin < 1 || v.samplesPerBin > WAVEFORM_LIMITS.seconds * 48e3 || !Number.isFinite(v.peakScale) || v.peakScale < 1 || v.peakScale > 1e6 || typeof v.peaksBase64 !== "string" || v.peaksBase64.length > WAVEFORM_LIMITS.bins * 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.peaksBase64))
    throw new Error("波形数据无效或超过大小限制");
  const binary = atob(v.peaksBase64), bins = Math.ceil(v.sampleCount / v.samplesPerBin);
  if (bins > WAVEFORM_LIMITS.bins || binary.length !== bins * 6 || (v.hasAudio ? v.sampleCount === 0 : v.sampleCount !== 0))
    throw new Error("波形长度不匹配");
  const data = new Int16Array(bins * 3);
  for (let i = 0; i < data.length; i++)
    data[i] = (binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8) << 16 >> 16;
  for (let i = 0; i < data.length; i += 3)
    if (data[i] > data[i + 1] || data[i + 2] < 0 || data[i + 2] > Math.max(Math.abs(data[i]), Math.abs(data[i + 1])) + 1)
      throw new Error("波形包络无效");
  const { peaksBase64: _, ...metadata } = v;
  return { ...metadata, data };
}

// src/editor/task-bridge.ts
var EDITOR_DEMO_NARRATION_SHA = "a57af26cc6bec773097f739da61e222548d72a5edc4fcaf377276696e7da3d40";
function isEditorDemoNarration(asset2) {
  return asset2.id === "demo-narration-v1" && asset2.name === "示例旁白 · 从想法，到成片。" && asset2.kind === "audio" && asset2.duration === 24 * 24e4 && asset2.metadata?.mimeType === "audio/mpeg" && !asset2.resourceId;
}
var EDITOR_TASK_LIMITS = Object.freeze({
  resourcesPerTask: 128,
  inputBytes: 2 * 1024 * 1024,
  documentBytes: 32 * 1024 * 1024,
  chunkBytes: 512 * 1024,
  snapshotResources: 1e4,
  proxiesPerTask: 120
});
function editorTaskDocument(value, sequenceId) {
  const document2 = validateEditorDocument(value), sequences = new Map(document2.sequences.map((sequence2) => [sequence2.id, sequence2]));
  if (!sequences.has(sequenceId)) throw new Error("所选导出序列不存在");
  const sequenceIds = /* @__PURE__ */ new Set(), assetIds = /* @__PURE__ */ new Set();
  const visit = (id3) => {
    if (sequenceIds.has(id3)) return;
    sequenceIds.add(id3);
    for (const clip2 of sequences.get(id3).clips) {
      if (clip2.kind === "sequence") visit(clip2.sequenceId);
      else if (clip2.kind === "media") assetIds.add(clip2.assetId);
      else if (clip2.kind === "multicam")
        clip2.angles.forEach((angle) => assetIds.add(angle.assetId));
    }
  };
  visit(sequenceId);
  document2.sequences = document2.sequences.filter((sequence2) => sequenceIds.has(sequence2.id));
  document2.assets = document2.assets.filter((asset2) => assetIds.has(asset2.id));
  document2.activeSequenceId = sequenceId;
  const resourceIds = /* @__PURE__ */ new Set();
  for (const asset2 of document2.assets) {
    if (asset2.kind === "demo" || isEditorDemoNarration(asset2)) continue;
    const id3 = asset2.resourceId ?? asset2.id;
    if (!isResourceId(id3)) throw new Error(`素材「${asset2.name}」尚未保存为可用于本地任务的资源`);
    asset2.resourceId = id3;
    resourceIds.add(id3);
  }
  if (resourceIds.size > EDITOR_TASK_LIMITS.snapshotResources)
    throw new Error(
      `单个导出快照最多包含 ${EDITOR_TASK_LIMITS.snapshotResources} 个资源，请拆分序列`
    );
  return { document: document2, resourceIds: [...resourceIds].sort() };
}
function editorProjectDocument(value) {
  const document2 = validateEditorDocument(value), resources = /* @__PURE__ */ new Set();
  if (document2.assets.length > EDITOR_TASK_LIMITS.snapshotResources)
    throw new Error("完整工程最多包含 10000 个素材");
  for (const asset2 of document2.assets) {
    if (asset2.kind === "demo" || isEditorDemoNarration(asset2)) continue;
    const id3 = asset2.resourceId ?? asset2.id;
    if (!isResourceId(id3))
      throw new Error(`素材「${asset2.name}」缺少已保存的原始资源，无法生成完整工程包`);
    resources.add(id3);
  }
  return { document: document2, resourceIds: [...resources].sort() };
}

// native/media/editor-audio-renderer.ts
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, closeSync, openSync, readSync, statSync, writeSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { setImmediate as yieldTask } from "node:timers/promises";

// src/editor/audio-plan.ts
var AUDIO_SAMPLE_RATE = 48e3;
var TICKS_PER_AUDIO_SAMPLE = 5;
var clamp = (n, low, high) => Math.max(low, Math.min(high, n));
var part = (kind, id3) => `${kind}:${encodeURIComponent(id3)}`;
var trackPath = (stage) => `${stage.sequencePath}/${part("track", stage.track.id)}`;
function rateAt(map, tick2) {
  let lo = 0, hi = map.points.length - 1;
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (map.points[mid].time <= tick2) lo = mid;
    else hi = mid;
  }
  const a = map.points[lo], b = map.points[hi];
  return (b.source - a.source) / (b.time - a.time);
}
function sampleAudioLane(lane, sample) {
  if (!Number.isSafeInteger(sample) || sample < 0 || !Number.isSafeInteger(sample * TICKS_PER_AUDIO_SAMPLE))
    throw new TypeError("Audio sample must be a nonnegative safe integer within the tick clock");
  let time2 = sample * TICKS_PER_AUDIO_SAMPLE;
  let gain = 1, pan = 0, pitchSemitones = 0, preservePitch = true, playbackRate = 1, fadeGain = 1, local = 0;
  const ducking = [];
  for (const stage of lane.stages) {
    local = time2 - stage.start;
    if (local < 0 || local >= stage.duration) return null;
    const mix = stage.audio;
    const fade = (mix.fadeIn ? clamp(local / mix.fadeIn, 0, 1) : 1) * (mix.fadeOut ? clamp((stage.duration - local) / mix.fadeOut, 0, 1) : 1);
    playbackRate *= rateAt(stage.timeMap, local);
    gain = stage.track.muted || !playbackRate ? 0 : clamp(evaluateAnimatedNumber(mix.volume, local), 0, 4) * stage.track.volume * fade * gain;
    pan = clamp(
      pan + stage.track.pan + clamp(evaluateAnimatedNumber(mix.pan, local), -1, 1),
      -1,
      1
    );
    pitchSemitones += mix.pitchSemitones;
    preservePitch &&= mix.preservePitch;
    fadeGain *= fade;
    if (mix.ducking)
      ducking.push({
        ...mix.ducking,
        sidechainTrackIds: [...mix.ducking.sidechainTrackIds],
        sequenceId: stage.sequenceId,
        sequenceTime: time2,
        trackInstanceId: trackPath(stage),
        sidechainTrackInstanceIds: mix.ducking.sidechainTrackIds.map(
          (id3) => `${stage.sequencePath}/${part("track", id3)}`
        )
      });
    time2 = sourceTimeAt(stage.timeMap, local);
  }
  time2 += lane.sourceOffset;
  if (time2 < 0 || time2 >= lane.sourceDuration) return null;
  const leaf = lane.stages[lane.stages.length - 1];
  return {
    instanceId: lane.instanceId,
    sequenceId: leaf.sequenceId,
    clipId: leaf.clipId,
    trackId: leaf.track.id,
    trackInstanceId: trackPath(leaf),
    trackInstancePath: [...lane.trackInstancePath],
    assetId: lane.assetId,
    sourceTime: time2,
    localTime: local,
    playbackRate,
    gain,
    pan,
    pitchSemitones,
    preservePitch,
    fadeGain,
    ducking,
    ...lane.angleId ? { angleId: lane.angleId } : {}
  };
}
function merge(ranges) {
  const result = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else if (range.start < range.end) result.push({ ...range });
  }
  return result;
}
function toRoot(ranges, stages, before) {
  for (let index = before - 1; index >= 0; index--) {
    const stage = stages[index];
    ranges = merge(
      ranges.flatMap(
        (range) => sourceRangesToTimeline(stage.timeMap, range.start, range.end).map((mapped) => ({
          start: mapped.start + stage.start,
          end: mapped.end + stage.start
        }))
      )
    );
  }
  return ranges;
}
function laneSpans(lane, duration) {
  const stages = lane.stages, leaf = stages[stages.length - 1];
  const lower = Math.max(0, -lane.sourceOffset), upper = lane.sourceDuration - lane.sourceOffset;
  if (upper <= lower) return [];
  const valid = toRoot(
    sourceRangesToTimeline(leaf.timeMap, lower, upper).map((range) => ({
      start: range.start + leaf.start,
      end: range.end + leaf.start
    })),
    stages,
    stages.length - 1
  );
  const boundaries = /* @__PURE__ */ new Set([0, Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE)]);
  const add2 = (ranges) => {
    for (const range of ranges) {
      boundaries.add(Math.ceil(range.start / TICKS_PER_AUDIO_SAMPLE));
      boundaries.add(Math.ceil(range.end / TICKS_PER_AUDIO_SAMPLE));
    }
    if (boundaries.size > 1e6)
      throw new RangeError("Expanded audio map exceeds one million spans");
  };
  add2(valid);
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];
    for (let point = 0; point + 1 < stage.timeMap.points.length; point++) {
      add2(
        toRoot(
          [
            {
              start: stage.start + stage.timeMap.points[point].time,
              end: stage.start + stage.timeMap.points[point + 1].time
            }
          ],
          stages,
          index
        )
      );
    }
  }
  const sorted = [...boundaries].sort((a, b) => a - b), spans = [];
  for (let index = 0; index + 1 < sorted.length; index++) {
    const startSample = sorted[index], endSample = sorted[index + 1];
    if (startSample >= Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE)) break;
    const first = sampleAudioLane(lane, startSample);
    if (!first || startSample === endSample) continue;
    const last = sampleAudioLane(lane, endSample - 1);
    if (!last || last.playbackRate !== first.playbackRate)
      throw new Error("Audio map partition lost a timing boundary");
    spans.push({
      startSample,
      endSample,
      playbackRate: first.playbackRate,
      sourceStart: first.sourceTime,
      sourceLast: last.sourceTime
    });
  }
  return spans;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function compileAudioPlan(value, sequenceId, options2 = {}) {
  const document2 = validateEditorDocument(value);
  const sequenceMap = new Map(document2.sequences.map((sequence2) => [sequence2.id, sequence2]));
  const assets = new Map(document2.assets.map((asset2) => [asset2.id, asset2]));
  const selected = sequenceMap.get(sequenceId);
  if (!selected) throw new Error(`Unknown audio sequence: ${sequenceId}`);
  const maxLanes = options2.maxLanes ?? 4096;
  if (!Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 16384)
    throw new RangeError("maxLanes must be between 1 and 16384");
  const duration = sequenceDuration(selected);
  const plan = {
    sequenceId,
    duration,
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 2,
    sampleCount: Math.ceil(duration / TICKS_PER_AUDIO_SAMPLE),
    lanes: [],
    ducking: []
  };
  const requests = /* @__PURE__ */ new Map();
  let expanded = 0;
  let spanCount = 0;
  const walk = (sequence2, path, ancestors) => {
    for (const track2 of sequence2.tracks)
      for (const clip2 of sequence2.clips.filter((item) => item.trackId === track2.id).sort((a, b) => a.start - b.start)) {
        if (clip2.kind !== "media" && clip2.kind !== "sequence" && clip2.kind !== "multicam") continue;
        if (++expanded > 1e5) throw new RangeError("Expanded audio graph exceeds 100000 clips");
        const stage = {
          sequenceId: sequence2.id,
          sequencePath: path,
          clipId: clip2.id,
          start: clip2.start,
          duration: clip2.duration,
          timeMap: clip2.timeMap,
          audio: clip2.audio,
          track: { id: track2.id, volume: track2.volume, pan: track2.pan, muted: track2.muted }
        };
        const stages = [...ancestors, stage], clipPath = `${path}/${part("clip", clip2.id)}`;
        if (clip2.kind === "sequence") {
          walk(
            sequenceMap.get(clip2.sequenceId),
            `${clipPath}/${part("sequence", clip2.sequenceId)}`,
            stages
          );
          continue;
        }
        let asset2, offset = 0, angleId;
        if (clip2.kind === "multicam") {
          const angle = clip2.angles.find((item) => item.id === clip2.audioAngleId);
          asset2 = assets.get(angle.assetId);
          offset = angle.offset;
          angleId = angle.id;
        } else asset2 = assets.get(clip2.assetId);
        if (asset2.kind !== "audio" && asset2.kind !== "video") continue;
        if (plan.lanes.length >= maxLanes)
          throw new RangeError(`Audio plan exceeds the ${maxLanes} instance capacity`);
        const duckingIds = [];
        for (const ancestor of stages)
          if (ancestor.audio.ducking) {
            const id3 = `${ancestor.sequencePath}/${part("clip", ancestor.clipId)}/ducking`;
            requests.set(id3, {
              ...ancestor.audio.ducking,
              id: id3,
              sidechainTrackInstanceIds: ancestor.audio.ducking.sidechainTrackIds.map(
                (trackId) => `${ancestor.sequencePath}/${part("track", trackId)}`
              )
            });
            duckingIds.push(id3);
          }
        const lane = {
          instanceId: `${clipPath}/audio`,
          assetId: asset2.id,
          assetKind: asset2.kind,
          sourceDuration: asset2.duration,
          sourceOffset: offset,
          stages,
          trackInstancePath: stages.map(trackPath),
          duckingIds,
          spans: [],
          ...angleId ? { angleId } : {}
        };
        lane.spans = laneSpans(lane, duration);
        spanCount += lane.spans.length;
        if (spanCount > 1e6)
          throw new RangeError("Audio plan exceeds one million expanded spans");
        plan.lanes.push(lane);
      }
  };
  walk(selected, part("sequence", sequenceId), []);
  plan.ducking = [...requests.values()];
  return freeze(plan);
}

// native/process-runner.ts
import { spawn } from "node:child_process";
function mediaAbortError() {
  return Object.assign(new Error("Media processing was cancelled"), { name: "AbortError" });
}
async function runMediaProcess(executable, args, options2) {
  if (options2.signal.aborted) throw mediaAbortError();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options2.cwd,
      env: options2.env,
      stdio: [options2.input ? "pipe" : "ignore", "pipe", "pipe"],
      // Keep every descendant in the Host-owned tool process group.
      detached: false,
      windowsHide: true
    });
    const stdout = [];
    let bytes = 0;
    let stderr = "";
    let progressBuffer = "";
    let lastProgress = 0;
    let failure;
    let spawnFailure;
    let pipeFailure;
    let exited = false;
    let inputFinished = !options2.input;
    const inputController = new AbortController();
    let killTimer;
    let progressWork = Promise.resolve();
    let inputWork = Promise.resolve();
    const asError = (error) => error instanceof Error ? error : new Error(String(error));
    const kill = (signal) => {
      try {
        child.kill(signal);
      } catch {
      }
    };
    const stop = () => {
      inputController.abort();
      child.stdin?.destroy();
      if (exited) return;
      kill("SIGTERM");
      killTimer ??= setTimeout(() => kill("SIGKILL"), 1500);
      killTimer.unref();
    };
    const cleanup = () => {
      options2.signal.removeEventListener("abort", stop);
      if (killTimer) clearTimeout(killTimer);
    };
    options2.signal.addEventListener("abort", stop, { once: true });
    if (options2.signal.aborted) stop();
    const consumeProgress = (text2) => {
      if (options2.durationSeconds && options2.onProgress) {
        progressBuffer += text2;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = (lines.pop() ?? "").slice(-4096);
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (!match || Date.now() - lastProgress < 150) continue;
          lastProgress = Date.now();
          const fraction = Math.min(0.999, Number(match[1]) / 1e6 / options2.durationSeconds);
          progressWork = progressWork.then(async () => {
            await options2.onProgress?.({ fraction });
          }).catch((error) => {
            failure = error instanceof Error ? error : new Error(String(error));
            stop();
          });
        }
      }
    };
    child.stdout.on("data", (chunk) => {
      try {
        if (options2.onStdout) options2.onStdout(chunk);
        else {
          bytes += chunk.length;
          if (bytes > (options2.maxStdoutBytes ?? 4 * 1024 * 1024)) {
            failure = new Error("Media tool output exceeds its bounded result budget");
            stop();
            return;
          }
          stdout.push(chunk);
        }
        if (options2.progressStream !== "stderr") consumeProgress(chunk.toString("utf8"));
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.stderr.on("data", (chunk) => {
      const text2 = chunk.toString("utf8");
      stderr = (stderr + text2).slice(-128 * 1024);
      try {
        options2.onStderr?.(text2);
        if (options2.progressStream === "stderr") consumeProgress(text2);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.once("error", (error) => {
      spawnFailure = error;
      stop();
    });
    child.once("exit", () => {
      exited = true;
      inputController.abort();
      child.stdin?.destroy();
    });
    child.stdin?.on("error", (error) => {
      if (!inputController.signal.aborted) {
        pipeFailure = error;
        stop();
      }
    });
    child.once("close", async (code) => {
      exited = true;
      inputController.abort();
      try {
        await Promise.all([inputWork, progressWork]);
        if (options2.signal.aborted) throw mediaAbortError();
        if (spawnFailure) throw spawnFailure;
        if (failure) throw failure;
        if (code !== 0)
          throw new Error(`${executable} exited with code ${code}: ${stderr.slice(-4e3)}`);
        if (pipeFailure) throw pipeFailure;
        if (!inputFinished)
          throw new Error(`${executable} exited before all media input was written`);
        resolve({ stdout: Buffer.concat(stdout), stderr });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    });
    if (options2.input) {
      const input = options2.input;
      const signal = inputController.signal;
      const write = (chunk) => new Promise((accept, decline) => {
        const aborted = () => {
          signal.removeEventListener("abort", aborted);
          decline(mediaAbortError());
        };
        const complete = (error) => {
          signal.removeEventListener("abort", aborted);
          if (error) decline(error);
          else accept();
        };
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) return aborted();
        try {
          if (chunk) child.stdin.write(chunk, complete);
          else child.stdin.end(() => complete());
        } catch (error) {
          complete(asError(error));
        }
      });
      inputWork = (async () => {
        let iterator;
        let exhausted = false;
        try {
          if (signal.aborted) return;
          iterator = input(signal)[Symbol.asyncIterator]();
          while (!signal.aborted) {
            const next = await iterator.next();
            if (next.done) {
              exhausted = true;
              break;
            }
            if (signal.aborted) break;
            if (!(next.value instanceof Uint8Array))
              throw new Error("Media input must yield Uint8Array chunks");
            await write(next.value);
          }
          if (!signal.aborted && exhausted) {
            await write();
            inputFinished = true;
          }
        } catch (error) {
          if (!signal.aborted) {
            failure ??= asError(error);
            stop();
          }
        } finally {
          if (iterator && !exhausted) {
            try {
              await iterator.return?.();
            } catch (error) {
              failure ??= asError(error);
              stop();
            }
          }
        }
      })();
    }
  });
}

// native/media/editor-audio-renderer.ts
var RATE = AUDIO_SAMPLE_RATE;
var CHANNELS = 2;
var BYTES = 8;
var BLOCK = 1024;
var CONTEXT = RATE / 4;
var CACHE_VERSION = "editor-audio-pcm-v2-timestamps";
var inputSafety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac"
];
var digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function editorSourcePcmCacheKey(sourceHash, sourceDuration, ffmpegVersion) {
  return digest({
    version: CACHE_VERSION,
    decoder: ffmpegVersion,
    hash: sourceHash,
    samples: Math.ceil(sourceDuration / TICKS_PER_AUDIO_SAMPLE) + RATE
  });
}
function cancelled(signal) {
  if (signal.aborted) throw mediaAbortError();
}
async function hashFile(path, signal) {
  const hash2 = createHash("sha256"), stream = createReadStream(path);
  const abort3 = () => stream.destroy(mediaAbortError());
  signal.addEventListener("abort", abort3, { once: true });
  try {
    cancelled(signal);
    for await (const chunk of stream) hash2.update(chunk);
    return hash2.digest("hex");
  } finally {
    signal.removeEventListener("abort", abort3);
    stream.destroy();
  }
}
async function pcmExists(path, exactSamples) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size % BYTES === 0 && (exactSamples === void 0 || info.size === exactSamples * BYTES);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
}
var PcmStore = class {
  files = /* @__PURE__ */ new Map();
  blocks = /* @__PURE__ */ new Map();
  blockSamples = 8192;
  file(path) {
    const saved = this.files.get(path);
    if (saved) {
      this.files.delete(path);
      this.files.set(path, saved);
      return saved;
    }
    if (this.files.size >= 32) {
      const key = this.files.keys().next().value;
      closeSync(this.files.get(key).fd);
      this.files.delete(key);
    }
    const size = statSync(path).size;
    if (size % BYTES) throw new Error(`Incomplete PCM cache: ${path}`);
    const file = { fd: openSync(path, "r"), samples: size / BYTES };
    this.files.set(path, file);
    return file;
  }
  sample(path, position, channel) {
    const lo = Math.floor(position), fraction = position - lo;
    const first = this.integer(path, lo, channel);
    return fraction ? first + (this.integer(path, lo + 1, channel) - first) * fraction : first;
  }
  integer(path, sample, channel) {
    const file = this.file(path);
    if (sample < 0 || sample >= file.samples) return 0;
    const block = Math.floor(sample / this.blockSamples), key = `${path}\0${block}`;
    let bytes = this.blocks.get(key);
    if (bytes) {
      this.blocks.delete(key);
      this.blocks.set(key, bytes);
    } else {
      if (this.blocks.size >= 64) this.blocks.delete(this.blocks.keys().next().value);
      bytes = Buffer.alloc(
        Math.min(this.blockSamples, file.samples - block * this.blockSamples) * BYTES
      );
      let read = 0;
      while (read < bytes.length) {
        const count = readSync(
          file.fd,
          bytes,
          read,
          bytes.length - read,
          block * this.blockSamples * BYTES + read
        );
        if (!count) throw new Error("PCM cache was truncated during render");
        read += count;
      }
      this.blocks.set(key, bytes);
    }
    const value = bytes.readFloatLE(sample % this.blockSamples * BYTES + channel * 4);
    if (!Number.isFinite(value)) throw new Error("Audio PCM contains a non-finite sample");
    return value;
  }
  dispose() {
    for (const file of this.files.values()) closeSync(file.fd);
    this.files.clear();
    this.blocks.clear();
  }
};
function tempoFilters(factor) {
  if (!(factor > 0) || !Number.isFinite(factor))
    throw new Error("The requested audio tempo is not representable");
  const filters = [];
  while (factor < 0.5) {
    filters.push("atempo=0.5");
    factor /= 0.5;
  }
  while (factor > 2) {
    filters.push("atempo=2");
    factor /= 2;
  }
  if (Math.abs(factor - 1) > 1e-12) filters.push(`atempo=${factor.toPrecision(17)}`);
  return filters;
}
async function renderEditorAudio(options2) {
  const { signal } = options2;
  cancelled(signal);
  for (const [name, path] of Object.entries({
    workDir: options2.workDir,
    cacheDir: options2.cacheDir,
    outputPath: options2.outputPath
  }))
    if (!isAbsolute(path)) throw new Error(`${name} must be an absolute authorized path`);
  const plan = compileAudioPlan(options2.document, options2.sequenceId);
  const lanes = plan.lanes.filter((lane) => lane.spans.length > 0);
  const budget = options2.maxPcmBytes ?? 64 * 1024 ** 3;
  const mixBudget = options2.maxMixBytes ?? 256 * 1024 ** 2;
  if (!Number.isSafeInteger(mixBudget) || mixBudget < BYTES)
    throw new RangeError("maxMixBytes must be a positive safe byte budget");
  if (!Number.isSafeInteger(budget) || budget < BYTES)
    throw new RangeError("maxPcmBytes must be a positive safe byte budget");
  let reserved = 0;
  const reserve = (bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || reserved + bytes > budget)
      throw new Error(`Audio PCM exceeds the configured ${budget} byte disk budget`);
    reserved += bytes;
  };
  reserve(plan.sampleCount * BYTES * 2);
  await mkdir(options2.workDir, { recursive: true });
  await mkdir(options2.cacheDir, { recursive: true });
  await mkdir(dirname(options2.outputPath), { recursive: true });
  const temporary = await mkdtemp(join(options2.workDir, "editor-audio-"));
  const outputTemporary = `${options2.outputPath}.${randomUUID()}.tmp`;
  const store = new PcmStore();
  const run = (executable, args) => runMediaProcess(executable, args, { signal });
  const result = {
    path: options2.outputPath,
    sampleRate: RATE,
    channels: CHANNELS,
    sampleCount: plan.sampleCount,
    peak: 0,
    samplesOverFullScale: 0,
    assets: [],
    processing: {
      algorithm: "sample-mapped-pcm+ffmpeg-atempo-wsola-v1",
      processedSpans: 0,
      spanCacheHits: 0,
      contextSamples: CONTEXT,
      pitchFactors: []
    },
    ducking: {
      detector: "10ms-exponential-rms",
      envelope: "one-pole-gain",
      sidechain: "pre-ducking-scoped-bus",
      requestCount: plan.ducking.length
    }
  };
  const progress2 = async (fraction, stage) => {
    cancelled(signal);
    await options2.onProgress?.({ fraction, stage });
  };
  try {
    const version = (await run(options2.ffmpegPath, ["-hide_banner", "-version"])).stdout.toString();
    const filters = (await run(options2.ffmpegPath, ["-hide_banner", "-filters"])).stdout.toString();
    for (const filter of ["aresample", "asetrate", "atempo", "atrim"])
      if (!new RegExp(`\\s${filter}\\s+A->A`).test(filters))
        throw new Error(`FFmpeg lacks the required ${filter} audio filter`);
    const assets = /* @__PURE__ */ new Map();
    const unique2 = [...new Map(lanes.map((lane) => [lane.assetId, lane])).values()];
    for (let index = 0; index < unique2.length; index++) {
      const lane = unique2[index];
      await progress2(0.2 * index / Math.max(1, unique2.length), "decode-audio");
      const path = await options2.resolveAssetPath(lane.assetId, signal);
      cancelled(signal);
      if (!isAbsolute(path))
        throw new Error(
          `Audio asset ${lane.assetId} was not materialized to an absolute local path`
        );
      const before = await stat(path);
      if (!before.isFile()) throw new Error(`Audio asset ${lane.assetId} is not a file`);
      const hash2 = await hashFile(path, signal);
      const probe = JSON.parse(
        (await run(options2.ffprobePath, [
          "-v",
          "error",
          ...inputSafety,
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=codec_type,sample_rate,channels",
          "-of",
          "json",
          path
        ])).stdout.toString()
      );
      if (!Array.isArray(probe.streams))
        throw new Error(`Invalid audio probe result for ${lane.assetId}`);
      if (!probe.streams.some((stream) => stream.codec_type === "audio")) {
        if (lane.assetKind === "audio")
          throw new Error(`Audio asset ${lane.assetId} contains no decodable audio stream`);
        assets.set(lane.assetId, { path: null, hash: hash2 });
        result.assets.push({
          assetId: lane.assetId,
          status: "no-audio-stream",
          sourceHash: hash2,
          sampleCount: 0,
          cacheHit: false
        });
        continue;
      }
      const samples = Math.ceil(lane.sourceDuration / TICKS_PER_AUDIO_SAMPLE) + RATE;
      reserve(samples * BYTES);
      const cachePath = join(
        options2.cacheDir,
        `${editorSourcePcmCacheKey(hash2, lane.sourceDuration, version)}.f32`
      );
      const cacheHit = await pcmExists(cachePath);
      if (!cacheHit) {
        const scratch = join(temporary, `${randomUUID()}.f32`);
        await run(options2.ffmpegPath, [
          "-nostdin",
          "-v",
          "error",
          ...inputSafety,
          "-copyts",
          "-start_at_zero",
          "-i",
          path,
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          // Preserve the audio stream's offset within a video and real timestamp gaps.
          "-af",
          `aresample=${RATE}:async=1:first_pts=0`,
          "-t",
          (samples / RATE).toPrecision(17),
          "-ac",
          "2",
          "-ar",
          String(RATE),
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "-y",
          scratch
        ]);
        if (!await pcmExists(scratch))
          throw new Error(`Decoder produced incomplete PCM for ${lane.assetId}`);
        const after = await stat(path);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new Error(`Audio asset ${lane.assetId} changed during rendering`);
        await rename(scratch, cachePath);
      }
      const sampleCount = (await stat(cachePath)).size / BYTES;
      if (!sampleCount) throw new Error(`Audio stream for ${lane.assetId} decoded to no samples`);
      if (sampleCount > samples)
        throw new Error(`Decoder exceeded the expected PCM bound for ${lane.assetId}`);
      assets.set(lane.assetId, { path: cachePath, hash: hash2 });
      result.assets.push({
        assetId: lane.assetId,
        status: "decoded",
        sourceHash: hash2,
        sampleCount,
        cacheHit
      });
    }
    const processed = /* @__PURE__ */ new Map();
    const spanTotal = lanes.reduce((sum, lane) => sum + lane.spans.length, 0);
    let spanIndex = 0;
    for (const lane of lanes)
      for (const span of lane.spans) {
        await progress2(0.2 + 0.3 * spanIndex++ / Math.max(1, spanTotal), "retime-audio");
        const asset2 = assets.get(lane.assetId);
        if (!asset2.path || span.playbackRate === 0) continue;
        const state = sampleAudioLane(lane, span.startSample);
        const speed = Math.abs(span.playbackRate), pitch = 2 ** (state.pitchSemitones / 12) * (state.preservePitch ? 1 : speed);
        if (state.pitchSemitones === 0 && speed === 1) continue;
        const shiftedRate = Math.round(RATE * pitch);
        if (!Number.isSafeInteger(shiftedRate) || shiftedRate < 1 || shiftedRate > 2147483647)
          throw new Error(
            `Audio pitch for ${lane.instanceId} exceeds FFmpeg's sample-rate capability`
          );
        const effectivePitch = shiftedRate / RATE;
        result.processing.pitchFactors.push({
          instanceId: lane.instanceId,
          requested: pitch,
          effective: effectivePitch
        });
        const count = span.endSample - span.startSample;
        const sourceCount = Math.ceil(count * speed) + 2 * CONTEXT;
        reserve((sourceCount + count) * BYTES);
        const cachePath = join(
          options2.cacheDir,
          `${digest({ version: CACHE_VERSION, decoder: version, source: asset2.hash, start: span.sourceStart, count, speed, direction: Math.sign(span.playbackRate), shiftedRate, context: CONTEXT })}.f32`
        );
        result.processing.processedSpans++;
        if (await pcmExists(cachePath, count)) {
          result.processing.spanCacheHits++;
          processed.set(span, cachePath);
          continue;
        }
        const input = join(temporary, `${randomUUID()}.f32`), output = join(temporary, `${randomUUID()}.f32`);
        const fd2 = openSync(input, "wx"), direction = Math.sign(span.playbackRate);
        try {
          for (let start = 0; start < sourceCount; start += BLOCK) {
            cancelled(signal);
            const length = Math.min(BLOCK, sourceCount - start), bytes = Buffer.allocUnsafe(length * BYTES);
            for (let i = 0; i < length; i++)
              for (let channel = 0; channel < CHANNELS; channel++)
                bytes.writeFloatLE(
                  store.sample(
                    asset2.path,
                    span.sourceStart / TICKS_PER_AUDIO_SAMPLE + direction * (start + i - CONTEXT),
                    channel
                  ),
                  i * BYTES + channel * 4
                );
            writeAll(fd2, bytes);
            await yieldTask();
          }
        } finally {
          closeSync(fd2);
        }
        const trimStart = Math.round(CONTEXT / speed);
        const chain = [
          `asetrate=${shiftedRate}`,
          `aresample=${RATE}`,
          ...tempoFilters(speed / effectivePitch),
          `atrim=start_sample=${trimStart}:end_sample=${trimStart + count}`
        ];
        await run(options2.ffmpegPath, [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "f32le",
          "-ar",
          String(RATE),
          "-ac",
          "2",
          "-i",
          input,
          "-af",
          chain.join(","),
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "-y",
          output
        ]);
        if (!await pcmExists(output, count))
          throw new Error(
            `FFmpeg time stretching could not provide all ${count} samples for ${lane.instanceId}; no silent tail was substituted`
          );
        await rename(output, cachePath);
        await rm(input);
        processed.set(span, cachePath);
      }
    const dryBuses = new Set(plan.ducking.flatMap((request) => request.sidechainTrackInstanceIds));
    const detector = new Map(plan.ducking.map((request) => [request.id, { power: 0, gain: 1 }]));
    const rmsCoefficient = Math.exp(-1 / (RATE * 0.01));
    const cursors = new Map(lanes.map((lane) => [lane, 0]));
    const raw = join(temporary, "mix.f32"), fd = openSync(raw, "wx");
    try {
      for (let start = 0; start < plan.sampleCount; start += BLOCK) {
        const count = Math.min(BLOCK, plan.sampleCount - start), end = start + count;
        let mixBytes = count * BYTES * 3;
        if (mixBytes > mixBudget)
          throw new Error(`Audio mixing exceeds the configured ${mixBudget} byte memory budget`);
        const allocate = (length) => {
          mixBytes += length * 8;
          if (mixBytes > mixBudget)
            throw new Error(`Audio mixing exceeds the configured ${mixBudget} byte memory budget`);
          return new Float64Array(length);
        };
        const buses = /* @__PURE__ */ new Map();
        const dry = [];
        for (const lane of lanes) {
          const asset2 = assets.get(lane.assetId);
          if (!asset2.path) continue;
          let cursor = cursors.get(lane);
          while (cursor < lane.spans.length && lane.spans[cursor].endSample <= start) cursor++;
          cursors.set(lane, cursor);
          const spans = [];
          while (cursor < lane.spans.length && lane.spans[cursor].startSample < end)
            spans.push(lane.spans[cursor++]);
          if (!spans.length) continue;
          const samples = allocate(count * CHANNELS);
          for (const span of spans)
            for (let sample = Math.max(start, span.startSample); sample < Math.min(end, span.endSample); sample++) {
              const state = sampleAudioLane(lane, sample);
              if (!state.gain || !state.playbackRate) continue;
              const transformed = processed.get(span), sourcePath2 = transformed ?? asset2.path;
              const coordinate2 = transformed ? sample - span.startSample : state.sourceTime / TICKS_PER_AUDIO_SAMPLE;
              const left = store.sample(sourcePath2, coordinate2, 0), right = store.sample(sourcePath2, coordinate2, 1);
              const angle = (state.pan <= 0 ? state.pan + 1 : state.pan) * Math.PI / 2;
              const l = (state.pan <= 0 ? left + right * Math.cos(angle) : left * Math.cos(angle)) * state.gain;
              const r = (state.pan <= 0 ? right * Math.sin(angle) : right + left * Math.sin(angle)) * state.gain;
              const offset = (sample - start) * CHANNELS;
              samples[offset] = l;
              samples[offset + 1] = r;
              for (const busId of lane.trackInstancePath) {
                if (dryBuses.has(busId)) {
                  let bus = buses.get(busId);
                  if (!bus) {
                    bus = allocate(count * CHANNELS);
                    buses.set(busId, bus);
                  }
                  bus[offset] += l;
                  bus[offset + 1] += r;
                }
              }
            }
          dry.push({ lane, samples });
        }
        const envelopes = /* @__PURE__ */ new Map();
        for (const request of plan.ducking) {
          const state = detector.get(request.id), envelope = allocate(count);
          const threshold = 10 ** (request.thresholdDb / 10), attenuation = 10 ** (-request.attenuationDb / 20);
          const attack = request.attack ? Math.exp(-TICKS_PER_AUDIO_SAMPLE / request.attack) : 0;
          const release = request.release ? Math.exp(-TICKS_PER_AUDIO_SAMPLE / request.release) : 0;
          for (let i = 0; i < count; i++) {
            let l = 0, r = 0;
            for (const id3 of request.sidechainTrackInstanceIds) {
              const bus = buses.get(id3);
              if (bus) {
                l += bus[i * CHANNELS];
                r += bus[i * CHANNELS + 1];
              }
            }
            state.power = rmsCoefficient * state.power + (1 - rmsCoefficient) * (l * l + r * r) / 2;
            const target = state.power >= threshold ? attenuation : 1;
            const coefficient = target < state.gain ? attack : release;
            state.gain = target + coefficient * (state.gain - target);
            envelope[i] = state.gain;
          }
          envelopes.set(request.id, envelope);
        }
        const mix = new Float64Array(count * CHANNELS);
        for (const item of dry)
          for (let i = 0; i < count; i++) {
            let gain = 1;
            for (const id3 of item.lane.duckingIds) gain *= envelopes.get(id3)[i];
            mix[i * CHANNELS] += item.samples[i * CHANNELS] * gain;
            mix[i * CHANNELS + 1] += item.samples[i * CHANNELS + 1] * gain;
          }
        const bytes = Buffer.allocUnsafe(count * BYTES);
        for (let i = 0; i < count; i++) {
          const peak = Math.max(Math.abs(mix[i * CHANNELS]), Math.abs(mix[i * CHANNELS + 1]));
          if (!Number.isFinite(peak) || peak > 34028234663852886e22)
            throw new Error(`Audio mix exceeds finite float PCM at sample ${start + i}`);
          result.peak = Math.max(result.peak, peak);
          if (peak > 1) result.samplesOverFullScale++;
          bytes.writeFloatLE(mix[i * CHANNELS], i * BYTES);
          bytes.writeFloatLE(mix[i * CHANNELS + 1], i * BYTES + 4);
        }
        writeAll(fd, bytes);
        await yieldTask();
        await progress2(0.5 + 0.45 * end / Math.max(1, plan.sampleCount), "mix-audio");
      }
    } finally {
      closeSync(fd);
    }
    await run(options2.ffmpegPath, [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "f32le",
      "-ar",
      String(RATE),
      "-ac",
      "2",
      "-i",
      raw,
      "-c:a",
      "pcm_f32le",
      "-rf64",
      "auto",
      "-f",
      "wav",
      "-y",
      outputTemporary
    ]);
    cancelled(signal);
    await rename(outputTemporary, options2.outputPath);
    await progress2(1, "audio-ready");
    return result;
  } finally {
    store.dispose();
    await rm(outputTemporary, { force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}

// native/media/editor-export.ts
import { constants as constants2 } from "node:fs";
import { copyFile, link, mkdir as mkdir4, rm as rm4, stat as stat3 } from "node:fs/promises";
import { randomUUID as randomUUID2 } from "node:crypto";
import { dirname as dirname3, isAbsolute as isAbsolute3, join as join4, relative, sep } from "node:path";

// native/media/editor-frame-renderer.ts
import { createReadStream as createReadStream2 } from "node:fs";
import { mkdir as mkdir3, mkdtemp as mkdtemp2, rm as rm3, stat as stat2 } from "node:fs/promises";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { isAbsolute as isAbsolute2, join as join3 } from "node:path";

// native/media/media-caption-renderer.ts
import { spawn as spawn2 } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir as mkdir2, readdir, rm as rm2, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname as dirname2, join as join2 } from "node:path";
async function findCaptionBrowser() {
  const names = process.platform === "win32" ? ["chrome.exe", "msedge.exe"] : process.platform === "linux" ? ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = process.platform === "linux" ? names.flatMap((name) => directories.map((path) => join2(path, name))) : directories.flatMap((path) => names.map((name) => join2(path, name)));
  const home = homedir();
  const localAppData = process.env.LOCALAPPDATA || join2(home, "AppData", "Local");
  if (process.platform === "win32") {
    const systemDrive = dirname2(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows");
    for (const root of [
      localAppData,
      process.env.PROGRAMFILES || join2(systemDrive, "Program Files"),
      process.env["PROGRAMFILES(X86)"] || join2(systemDrive, "Program Files (x86)")
    ])
      candidates.push(
        join2(root, "Google", "Chrome", "Application", "chrome.exe"),
        join2(root, "Microsoft", "Edge", "Application", "msedge.exe")
      );
  }
  if (process.platform === "darwin")
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join2(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    );
  const cacheRoots = process.platform === "win32" ? [join2(localAppData, "ms-playwright")] : [join2(home, "Library/Caches/ms-playwright"), join2(home, ".cache/ms-playwright")];
  for (const root of cacheRoots) {
    for (const name of await readdir(root).catch(() => [])) {
      if (!/^chromium[-_]/.test(name)) continue;
      for (const binary of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/chrome",
        "chrome-linux64/chrome",
        "chrome-win/chrome.exe",
        "chrome-win64/chrome.exe"
      ])
        candidates.push(join2(root, name, binary));
    }
  }
  for (const path of candidates)
    if (await access(path, constants.X_OK).then(
      () => true,
      () => false
    ))
      return path;
  return void 0;
}
var CaptionBrowser = class {
  child;
  pending = /* @__PURE__ */ new Map();
  nextId = 0;
  buffer = Buffer.alloc(0);
  closed = false;
  closingStarted = false;
  closing;
  exited;
  diagnostic = new Error("浏览器未提供启动诊断");
  constructor(executable, profile) {
    this.child = spawn2(
      executable,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-extensions",
        `--user-data-dir=${profile}`,
        "about:blank"
      ],
      {
        detached: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
      }
    );
    let stderr = Buffer.alloc(0);
    this.diagnostic.name = "CaptionBrowserDiagnostics";
    const updateDiagnostic = (exit = "") => {
      this.diagnostic.message = `Browser: ${executable}
${stderr.toString("utf8")}
${exit}`.slice(
        -12288
      );
    };
    updateDiagnostic();
    this.child.stderr.on("data", (chunk) => {
      stderr = Buffer.from(Buffer.concat([stderr, chunk]).subarray(-8192));
      updateDiagnostic();
    });
    this.child.stderr.on("error", () => {
    });
    this.exited = new Promise(
      (resolve) => this.child.once("close", (code, signal) => {
        updateDiagnostic(`Exit code: ${code ?? "none"}; signal: ${signal ?? "none"}`);
        this.fail(this.failure("字幕绘制进程已停止"));
        resolve();
      })
    );
    this.child.once("error", () => this.fail(this.failure("无法启动字幕绘制浏览器")));
    for (const pipe of [this.child.stdio[3], this.child.stdio[4]])
      pipe.on("error", (error) => {
        if (this.closingStarted && ["ECONNRESET", "EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? ""))
          return;
        this.fail(this.failure("字幕绘制连接已中断"));
        void this.close();
      });
    this.child.stdio[4].on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 32 * 1024 * 1024) {
        this.fail(new Error("字幕图像超过大小限制"));
        void this.close();
        return;
      }
      let end;
      while ((end = this.buffer.indexOf(0)) >= 0) {
        const part2 = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 1);
        let message;
        try {
          message = JSON.parse(part2.toString("utf8"));
        } catch {
          this.fail(new Error("字幕绘制返回无效数据"));
          continue;
        }
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error("字幕绘制命令失败"));
        else entry.resolve(message.result);
      }
    });
  }
  failure(message) {
    if (this.diagnostic.message.includes("No usable sandbox"))
      message = "字幕浏览器的安全环境不可用，请安装或选择可用的系统版 Chrome 后重试";
    return new Error(message, { cause: this.diagnostic });
  }
  fail(error) {
    this.closed = true;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
  call(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("字幕绘制进程已停止"));
    return new Promise((resolve, reject) => {
      const id3 = ++this.nextId;
      this.pending.set(id3, { resolve, reject });
      this.child.stdio[3].write(
        JSON.stringify({ id: id3, method, params, ...sessionId ? { sessionId } : {} }) + "\0",
        (error) => {
          if (error) {
            this.pending.delete(id3);
            reject(new Error("无法发送字幕绘制请求"));
          }
        }
      );
    });
  }
  close() {
    if (this.closing) return this.closing;
    this.closingStarted = true;
    this.fail(new Error("字幕绘制已取消"));
    this.closing = Promise.resolve().then(async () => {
      let timer;
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill("SIGTERM");
        timer = setTimeout(() => this.child.kill("SIGKILL"), 1500);
        timer.unref();
      }
      await this.exited;
      if (timer) clearTimeout(timer);
    });
    return this.closing;
  }
};

// native/media/editor-frame-renderer.ts
var MIME_TYPES = /* @__PURE__ */ new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);
var abortError = () => new DOMException("画面渲染已取消", "AbortError");
var EditorFrameRenderer = class _EditorFrameRenderer {
  constructor(options2) {
    this.options = options2;
    this.document = validateEditorDocument(options2.document);
    this.profile = validateExportProfile(options2.profile);
    const sequence2 = this.document.sequences.find((item) => item.id === options2.sequenceId);
    if (!sequence2) throw new Error("渲染序列不存在");
    this.duration = sequenceDuration(sequence2);
    if (!this.duration) throw new Error("空序列没有可导出的画面");
    if (!isAbsolute2(options2.workDir)) throw new Error("渲染工作目录无效");
    if (typeof options2.runtimeSource !== "string" || !options2.runtimeSource || options2.runtimeSource.length > 4 * 1024 * 1024)
      throw new Error("渲染运行代码无效");
    if (options2.timeoutMs !== void 0 && (!Number.isInteger(options2.timeoutMs) || options2.timeoutMs < 100 || options2.timeoutMs > 3e5))
      throw new Error("渲染超时设置无效");
  }
  options;
  document;
  profile;
  duration;
  server;
  browser;
  browserProfile = "";
  sessionId = "";
  origin = "";
  base = `/${randomBytes(24).toString("hex")}`;
  files = /* @__PURE__ */ new Map();
  requestId = 0;
  upload;
  closed = false;
  closing;
  busy = false;
  onAbort = () => {
    void this.close();
  };
  static async create(options2) {
    const renderer = new _EditorFrameRenderer(options2);
    try {
      await renderer.bounded(() => renderer.initialize());
      return renderer;
    } catch (error) {
      await renderer.close();
      if (options2.signal.aborted) throw abortError();
      throw error;
    }
  }
  async initialize() {
    if (this.options.signal.aborted) throw abortError();
    this.options.signal.addEventListener("abort", this.onAbort, { once: true });
    const urls = /* @__PURE__ */ Object.create(null);
    let fileIndex = 0;
    for (const [assetId, file] of this.options.mediaFiles) {
      if (!this.document.assets.some((asset2) => asset2.id === assetId))
        throw new Error("渲染文件包含未知素材");
      if (!isAbsolute2(file.path) || !MIME_TYPES.has(file.mimeType))
        throw new Error(`渲染素材类型或路径无效：${assetId}`);
      const info = await stat2(file.path);
      if (!info.isFile() || info.size <= 0) throw new Error(`渲染素材不可读取：${assetId}`);
      const route = `${this.base}/media/${fileIndex++}`;
      this.files.set(route, { ...file });
      urls[assetId] = route;
      if (this.closed) throw abortError();
    }
    this.server = createServer((request, response) => {
      void this.serve(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    this.server.requestTimeout = 3e4;
    this.server.headersTimeout = 1e4;
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    if (this.closed) {
      this.server.closeAllConnections();
      await new Promise((resolve) => this.server.close(() => resolve()));
      throw abortError();
    }
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("无法准备画面渲染媒体服务");
    this.origin = `http://127.0.0.1:${address.port}`;
    const executable = this.options.browserPath ?? await findCaptionBrowser();
    if (this.closed) throw abortError();
    if (!executable) throw new Error("视频渲染需要已安装的 Chrome、Chromium 或 Edge 浏览器");
    await mkdir3(this.options.workDir, { recursive: true });
    if (this.closed) throw abortError();
    this.browserProfile = await mkdtemp2(join3(this.options.workDir, "editor-browser-"));
    if (this.closed) {
      await rm3(this.browserProfile, { recursive: true, force: true });
      throw abortError();
    }
    this.browser = new CaptionBrowser(executable, this.browserProfile);
    const target = await this.browser.call("Target.createTarget", { url: "about:blank" });
    const session = await this.browser.call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true
    });
    this.sessionId = session.sessionId;
    await this.browser.call("Page.enable", {}, this.sessionId);
    await this.browser.call(
      "Page.navigate",
      { url: `${this.origin}${this.base}/` },
      this.sessionId
    );
    for (; ; ) {
      const response = await this.browser.call(
        "Runtime.evaluate",
        {
          expression: `location.href === ${JSON.stringify(`${this.origin}${this.base}/`)} && document.readyState === 'complete'`,
          returnByValue: true
        },
        this.sessionId
      );
      if (response.result?.value === true) break;
      if (this.closed) throw abortError();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await this.evaluate(this.options.runtimeSource);
    for (const key of Object.keys(urls)) urls[key] = `${this.origin}${urls[key]}`;
    const args = [
      this.document,
      this.options.sequenceId,
      this.profile,
      urls,
      `${this.origin}${this.base}/frame`
    ];
    await this.evaluate(`globalThis.videoStudioRender.initialize(...${JSON.stringify(args)})`);
  }
  async evaluate(expression) {
    if (this.closed || !this.browser) throw abortError();
    const response = await this.browser.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      this.sessionId
    );
    if (response.exceptionDetails) {
      const raw = response.exceptionDetails.exception?.description ?? "画面合成失败";
      const firstLine = String(raw).split("\n", 1)[0].slice(0, 500);
      throw new Error(`画面合成失败：${firstLine}`);
    }
  }
  async bounded(operation) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            void this.close();
            reject(new Error("画面渲染超时"));
          }, this.options.timeoutMs ?? 3e4);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async render(time2) {
    assertTick(time2);
    if (time2 >= this.duration) throw new Error("渲染时间超出序列范围");
    if (this.closed || this.options.signal.aborted) throw abortError();
    if (this.busy) throw new Error("请等待上一画面绘制完成");
    this.busy = true;
    const current = { id: this.requestId++, receiving: false };
    this.upload = current;
    try {
      await this.bounded(
        () => this.evaluate(`globalThis.videoStudioRender.render(${time2}, ${current.id})`)
      );
      if (this.options.signal.aborted) throw abortError();
      if (!current.bytes) throw new Error("渲染器未返回画面");
      return current.bytes;
    } catch (error) {
      await this.close();
      if (this.options.signal.aborted) throw abortError();
      throw error;
    } finally {
      this.upload = void 0;
      this.busy = false;
    }
  }
  async serve(request, response) {
    const deny = (code = 404) => {
      response.writeHead(code);
      response.end();
    };
    if (this.closed || request.headers.host !== this.origin.slice(7) || request.headers.origin && request.headers.origin !== this.origin)
      return deny(403);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const route = request.url ?? "";
    if (route === `${this.base}/` && request.method === "GET") {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; img-src 'self'; media-src 'self'; connect-src 'self'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><meta charset=utf-8><title>Video Studio renderer</title>");
      return;
    }
    const current = this.upload;
    if (current && route === `${this.base}/frame/${current.id}` && request.method === "POST") {
      if (current.receiving || current.bytes || request.headers["content-type"] !== "image/png")
        return deny(409);
      current.receiving = true;
      const maxBytes = this.profile.width * this.profile.height * 5 + 1024 * 1024;
      if (Number(request.headers["content-length"]) > maxBytes) return deny(413);
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > maxBytes || this.closed) {
          request.destroy();
          return;
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, length);
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== this.profile.width || bytes.readUInt32BE(20) !== this.profile.height)
        return deny(422);
      current.bytes = bytes;
      response.writeHead(204);
      response.end();
      return;
    }
    const file = this.files.get(route);
    if (!file || !["GET", "HEAD"].includes(request.method ?? "")) return deny();
    const info = await stat2(file.path);
    if (!info.isFile()) return deny();
    let start = 0, end = info.size - 1, partial = false;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || !match[1] && !match[2]) return deny(416);
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size)
        return deny(416);
      partial = true;
    }
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", end - start + 1);
    if (partial) response.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    response.writeHead(partial ? 206 : 200);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream2(file.path, { start, end });
    response.once("close", () => stream.destroy());
    stream.once("error", () => response.destroy());
    stream.pipe(response);
  }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.options.signal.removeEventListener("abort", this.onAbort);
    this.closing = (async () => {
      await this.browser?.close();
      if (this.server?.listening) {
        this.server.closeAllConnections();
        await new Promise((resolve) => this.server.close(() => resolve()));
      }
      if (this.browserProfile) await rm3(this.browserProfile, { recursive: true, force: true });
      this.files.clear();
      this.upload = void 0;
    })();
    return this.closing;
  }
};

// native/media/editor-export.ts
async function publishWithoutOverwrite(source2, destination) {
  try {
    await link(source2, destination);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await copyFile(source2, destination, constants2.COPYFILE_EXCL);
  }
  await rm4(source2);
}
async function exportEditorSequence(options2) {
  const document2 = validateEditorDocument(options2.document);
  const profile = validateExportProfile(options2.profile);
  const sequence2 = document2.sequences.find((item) => item.id === options2.sequenceId);
  if (!sequence2) throw new Error("导出序列不存在");
  const duration = sequenceDuration(sequence2);
  const frameCount = ticksToFrame(duration, profile.frameRate, "ceil");
  if (!frameCount) throw new Error("空序列无法导出");
  const durationSeconds = frameCount * profile.frameRate.denominator / profile.frameRate.numerator;
  const outputRelation = relative(options2.workDir, options2.outputPath);
  if (!isAbsolute3(options2.workDir) || !isAbsolute3(options2.outputPath) || !outputRelation || outputRelation === ".." || outputRelation.startsWith(`..${sep}`) || isAbsolute3(outputRelation))
    throw new Error("导出文件必须位于当前任务工作目录中");
  if (!isAbsolute3(options2.audioFile) || !(await stat3(options2.audioFile)).isFile())
    throw new Error("导出缺少完整的音频混音文件");
  const ffmpeg = options2.ffmpegPath ?? "ffmpeg", ffprobe = options2.ffprobePath ?? "ffprobe";
  const signal = options2.signal;
  await options2.onProgress?.({ phase: "prepare", completedFrames: 0, totalFrames: frameCount });
  const encoders = await runMediaProcess(ffmpeg, ["-hide_banner", "-encoders"], { signal });
  const names = encoders.stdout.toString("utf8").split("\n").flatMap((line) => /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line)?.[1] ?? []);
  assertExportEncodersAvailable(profile, names);
  const audioResult = await runMediaProcess(
    ffprobe,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", options2.audioFile],
    { signal }
  );
  const audioProbe = JSON.parse(audioResult.stdout.toString("utf8"));
  const tracks = audioProbe.streams;
  const seconds = Number(tracks?.[0]?.duration ?? audioProbe.format?.duration);
  if (!Array.isArray(tracks) || tracks.length !== 1 || tracks[0].codec_type !== "audio" || !["pcm_s16le", "pcm_f32le"].includes(tracks[0].codec_name) || Number(tracks[0].sample_rate) !== 48e3 || tracks[0].channels !== 2 || !Number.isFinite(seconds) || Math.abs(seconds - ticksToSeconds(duration)) > 1 / 48e3 + 1e-6)
    throw new Error("音频混音的格式或时长与序列不一致");
  await mkdir4(dirname3(options2.outputPath), { recursive: true });
  const temporary = join4(
    dirname3(options2.outputPath),
    `.render-${randomUUID2()}.${profile.container}`
  );
  let renderer;
  try {
    renderer = await EditorFrameRenderer.create({ ...options2, document: document2, profile });
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-framerate",
        `${profile.frameRate.numerator}/${profile.frameRate.denominator}`,
        "-i",
        "pipe:0",
        "-i",
        options2.audioFile,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        // Lock conversion before the output size/pixel-format stage. Older FFmpeg
        // can otherwise negotiate RGB here and insert a later default BT.601 conversion.
        `scale=out_color_matrix=bt709:out_range=limited,format=${profile.videoCodec === "prores" ? "yuv422p10le" : "yuv420p"},setparams=colorspace=bt709:range=limited`,
        "-af",
        `apad,atrim=end_sample=${Math.ceil(durationSeconds * 48e3)}`,
        ...exportEncodingArguments(profile),
        "-color_primaries",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-frames:v",
        String(frameCount),
        temporary
      ],
      {
        signal,
        input: async function* (inputSignal) {
          const stop = () => {
            void renderer?.close();
          };
          inputSignal.addEventListener("abort", stop, { once: true });
          try {
            for (let frame = 0; frame < frameCount; frame++) {
              if (inputSignal.aborted) throw new DOMException("视频编码已取消", "AbortError");
              yield await renderer.render(frameToTicks(frame, profile.frameRate));
              await options2.onProgress?.({
                phase: "render",
                completedFrames: frame + 1,
                totalFrames: frameCount
              });
            }
          } finally {
            inputSignal.removeEventListener("abort", stop);
          }
        }
      }
    );
    await renderer.close();
    await options2.onProgress?.({
      phase: "verify",
      completedFrames: frameCount,
      totalFrames: frameCount
    });
    const result = await runMediaProcess(
      ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", temporary],
      { signal }
    );
    const probe = JSON.parse(result.stdout.toString("utf8"));
    verifyExportOutput(profile, probe, ticksToSeconds(duration));
    if (signal.aborted) throw new DOMException("视频导出已取消", "AbortError");
    await publishWithoutOverwrite(temporary, options2.outputPath);
    return { path: options2.outputPath, frameCount, durationSeconds, probe };
  } finally {
    await renderer?.close();
    await rm4(temporary, { force: true });
  }
}

// native/media/media-executables.ts
import { constants as constants3 } from "node:fs";
import { access as access2, realpath, stat as stat4 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { delimiter as delimiter2, isAbsolute as isAbsolute4, join as join5 } from "node:path";
function executableSearchDirectories() {
  return [
    ...new Set(
      [
        ...(process.env.PATH ?? "").split(delimiter2),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join5(homedir2(), ".local/bin")
      ].filter(isAbsolute4)
    )
  ];
}
async function findExecutable(name, explicit, directories = executableSearchDirectories()) {
  const choices = explicit ? [explicit] : directories.map((dir) => join5(dir, process.platform === "win32" ? `${name}.exe` : name));
  for (const path of choices) {
    try {
      await access2(path, constants3.X_OK);
      if ((await stat4(path)).isFile()) return await realpath(path);
    } catch {
    }
  }
  return void 0;
}

// native/editor-runtime/files.ts
import { constants as constants4 } from "node:fs";
import { copyFile as copyFile2, lstat, mkdir as mkdir5, open, realpath as realpath2, rename as rename2, rm as rm5, stat as stat5 } from "node:fs/promises";
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
import { join as join6, relative as relative2, sep as sep2 } from "node:path";

// native/editor-runtime/protocol.ts
var EditorTaskError = class extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "EditorTaskError";
  }
  code;
  retryable;
};
function record(value, keys, label2) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key)))
    throw new EditorTaskError("INVALID_REQUEST", `${label2}包含无效或不支持的字段`);
  return value;
}
function hash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "内容校验编号无效");
  return value;
}
function resourceId(value) {
  if (typeof value !== "string" || !/^(?:asset|external)-[a-f0-9]{64}$/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "素材资源编号无效");
  return value;
}
function integer3(value, min, max) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new EditorTaskError("INVALID_REQUEST", "请求数量或范围无效");
  return Number(value);
}
function id2(value) {
  if (typeof value !== "string" || !value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value))
    throw new EditorTaskError("INVALID_REQUEST", "编辑器对象编号无效");
  return value;
}
function array2(value, maximum, item) {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1)
    throw new EditorTaskError("INVALID_REQUEST", "请求列表无效或超过上限");
  const list2 = value.map(item);
  if (new Set(list2).size !== list2.length)
    throw new EditorTaskError("INVALID_REQUEST", "请求列表存在重复项");
  return list2;
}
function validateEditorRequest(value) {
  const input = record(
    value,
    [
      "action",
      "transferId",
      "documentHash",
      "sequenceId",
      "resourceIds",
      "assetIds",
      "chunkIndex",
      "chunkCount",
      "byteLength",
      "dataBase64",
      "profile",
      "preparedAudio",
      "sourceDuration",
      "alignment",
      "bundleHash",
      "batchIndex"
    ],
    "编辑器任务"
  );
  const actions = {
    "inspect-source": ["resourceIds"],
    "analyze-waveform": ["resourceIds", "sourceDuration"],
    "align-multicam": ["resourceIds", "alignment"],
    "analyze-asset-waveform": ["documentHash", "sequenceId", "assetIds"],
    "prepare-source-video": ["resourceIds", "sourceDuration"],
    "stage-status": ["documentHash", "resourceIds"],
    "stage-resources": ["resourceIds"],
    "stage-document": ["documentHash", "chunkIndex", "chunkCount", "dataBase64"],
    commit: ["documentHash", "sequenceId", "chunkCount", "byteLength"],
    "commit-project": ["documentHash", "sequenceId", "chunkCount", "byteLength"],
    "export-project": ["documentHash", "sequenceId"],
    "import-project": ["resourceIds"],
    "project-import-status": ["bundleHash"],
    "publish-project-media": ["bundleHash", "batchIndex"],
    "discard-project-import": ["bundleHash"],
    "prepare-audio": ["documentHash", "sequenceId"],
    "prepare-video": ["documentHash", "sequenceId", "assetIds"],
    render: ["documentHash", "sequenceId", "profile", "preparedAudio"],
    discard: ["documentHash", "sequenceId"]
  };
  if (typeof input.action !== "string" || !Object.hasOwn(actions, input.action))
    throw new EditorTaskError("INVALID_REQUEST", "不支持此编辑器任务");
  const action = input.action;
  record(input, ["action", "transferId", ...actions[action]], "编辑器任务");
  if (typeof input.transferId !== "string" || !/^editor-[a-f0-9-]{36}$/.test(input.transferId))
    throw new EditorTaskError("INVALID_REQUEST", "编辑器传输编号无效");
  const result = { action, transferId: input.transferId };
  if (actions[action].includes("bundleHash")) result.bundleHash = hash(input.bundleHash);
  if (action === "publish-project-media")
    result.batchIndex = integer3(
      input.batchIndex,
      0,
      Math.ceil(EDITOR_TASK_LIMITS.snapshotResources / 120) - 1
    );
  if (actions[action].includes("documentHash")) result.documentHash = hash(input.documentHash);
  if (actions[action].includes("sequenceId")) result.sequenceId = id2(input.sequenceId);
  if (actions[action].includes("resourceIds"))
    result.resourceIds = array2(input.resourceIds, EDITOR_TASK_LIMITS.resourcesPerTask, resourceId);
  if (["inspect-source", "analyze-waveform", "prepare-source-video", "import-project"].includes(
    action
  ) && result.resourceIds.length !== 1)
    throw new EditorTaskError("INVALID_REQUEST", "每个素材分析任务须提供一个资源");
  if (["analyze-waveform", "prepare-source-video"].includes(action))
    result.sourceDuration = integer3(input.sourceDuration, 1, 86400 * 24e4);
  if (action === "align-multicam") {
    const value2 = record(
      input.alignment,
      [
        "referenceResourceId",
        "windowSeconds",
        "maxOffsetSeconds",
        "sourceDurations",
        "sourceHashes",
        "origin"
      ],
      "机位同步参数"
    );
    if (result.resourceIds.length < 2 || result.resourceIds.length > 32)
      throw new EditorTaskError("INVALID_REQUEST", "机位同步需要 2 至 32 个资源");
    const referenceResourceId = resourceId(value2.referenceResourceId), windowSeconds = integer3(value2.windowSeconds, 3, 180), maxOffsetSeconds = integer3(value2.maxOffsetSeconds, 0, 60);
    if (!result.resourceIds.includes(referenceResourceId) || maxOffsetSeconds >= windowSeconds - 2 || !Array.isArray(value2.sourceDurations) || value2.sourceDurations.length !== result.resourceIds.length)
      throw new EditorTaskError("INVALID_REQUEST", "机位同步范围或基准无效");
    result.alignment = {
      referenceResourceId,
      windowSeconds,
      maxOffsetSeconds,
      sourceDurations: value2.sourceDurations.map(
        (duration) => integer3(duration, 1, 86400 * 24e4)
      )
    };
    if (value2.sourceHashes !== void 0) {
      if (!Array.isArray(value2.sourceHashes) || value2.sourceHashes.length !== result.resourceIds.length)
        throw new EditorTaskError("INVALID_REQUEST", "素材指纹列表无效");
      result.alignment.sourceHashes = value2.sourceHashes.map(
        (value3) => value3 === null ? null : hash(value3)
      );
    }
    if (value2.origin !== void 0) {
      const origin = record(
        value2.origin,
        ["documentId", "revision", "documentHash", "referenceAssetId", "assets"],
        "机位同步来源"
      );
      if (!Array.isArray(origin.assets) || origin.assets.length !== result.resourceIds.length)
        throw new EditorTaskError("INVALID_REQUEST", "机位同步来源列表无效");
      const assets = origin.assets.map((raw, index) => {
        const asset2 = record(raw, ["assetId", "resourceId"], "机位素材映射");
        if (asset2.resourceId !== result.resourceIds[index])
          throw new EditorTaskError("INVALID_REQUEST", "机位素材映射不匹配");
        return { assetId: id2(asset2.assetId), resourceId: resourceId(asset2.resourceId) };
      });
      if (new Set(assets.map((asset2) => asset2.assetId)).size !== assets.length || !assets.some(
        (asset2) => asset2.assetId === origin.referenceAssetId && asset2.resourceId === referenceResourceId
      ))
        throw new EditorTaskError("INVALID_REQUEST", "同步基准机位映射无效");
      result.alignment.origin = {
        documentId: id2(origin.documentId),
        revision: integer3(origin.revision, 0, Number.MAX_SAFE_INTEGER),
        documentHash: hash(origin.documentHash),
        referenceAssetId: id2(origin.referenceAssetId),
        assets
      };
    }
  }
  if (action === "stage-resources" && !result.resourceIds.length)
    throw new EditorTaskError("INVALID_REQUEST", "请提供本批素材资源");
  if (["prepare-video", "analyze-asset-waveform"].includes(action)) {
    result.assetIds = array2(input.assetIds, EDITOR_TASK_LIMITS.proxiesPerTask, id2);
    if (action === "analyze-asset-waveform" && result.assetIds.length !== 1)
      throw new EditorTaskError("INVALID_REQUEST", "每次分析一个工程声音素材");
    if (!result.assetIds.length) throw new EditorTaskError("INVALID_REQUEST", "请提供视频素材");
  }
  if (action === "stage-document" || action === "commit" || action === "commit-project")
    result.chunkCount = integer3(
      input.chunkCount,
      1,
      EDITOR_TASK_LIMITS.documentBytes / EDITOR_TASK_LIMITS.chunkBytes
    );
  if (action === "stage-document") {
    result.chunkIndex = integer3(input.chunkIndex, 0, result.chunkCount - 1);
    if (typeof input.dataBase64 !== "string" || input.dataBase64.length > Math.ceil(EDITOR_TASK_LIMITS.chunkBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64) || !input.dataBase64)
      throw new EditorTaskError("INVALID_REQUEST", "工程数据块无效或超过大小限制");
    result.dataBase64 = input.dataBase64;
  }
  if (action === "commit" || action === "commit-project")
    result.byteLength = integer3(input.byteLength, 1, EDITOR_TASK_LIMITS.documentBytes);
  if (action === "render") {
    result.profile = validateExportProfile(input.profile);
    if (input.preparedAudio !== void 0) {
      const audio2 = record(
        input.preparedAudio,
        ["documentHash", "sequenceId", "recipeHash", "assetId"],
        "已准备声音"
      );
      result.preparedAudio = {
        documentHash: hash(audio2.documentHash),
        sequenceId: id2(audio2.sequenceId),
        recipeHash: hash(audio2.recipeHash),
        assetId: resourceId(audio2.assetId)
      };
      if (!result.preparedAudio.assetId.startsWith("asset-") || audio2.documentHash !== result.documentHash || audio2.sequenceId !== result.sequenceId)
        throw new EditorTaskError("MIX_MISMATCH", "已准备声音与当前工程快照不一致");
    }
  }
  return result;
}

// native/editor-runtime/files.ts
var digest2 = (value) => createHash2("sha256").update(JSON.stringify(value)).digest("hex");
var bytesHash = (bytes) => createHash2("sha256").update(bytes).digest("hex");
function abort(signal) {
  if (signal.aborted) throw mediaAbortError();
}
async function sealed(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new EditorTaskError("INVALID_DIRECTORY", "任务目录不是授权的普通目录");
  return realpath2(path);
}
async function directory(root, parts) {
  let path = root;
  for (const part2 of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part2) || part2 === "." || part2 === "..")
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录无效");
    path = join6(path, part2);
    await mkdir5(path, { mode: 448 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath2(path) !== path)
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录已变化");
  }
  return path;
}
async function regular(root, parts) {
  let path = root;
  for (const part2 of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part2) || part2 === "." || part2 === "..")
      throw new EditorTaskError("INVALID_FILE", "任务文件名无效");
    path = join6(path, part2);
    if ((await lstat(path)).isSymbolicLink())
      throw new EditorTaskError("INVALID_FILE", "任务材料不能使用符号链接");
  }
  const canonical = await realpath2(path);
  if (!canonical.startsWith(root + sep2) || !(await stat5(canonical)).isFile())
    throw new EditorTaskError("INVALID_FILE", "任务材料不在授权目录内");
  return canonical;
}
async function fileHash(path, signal) {
  abort(signal);
  const hash2 = createHash2("sha256"), file = await open(path, constants4.O_RDONLY | (constants4.O_NOFOLLOW ?? 0)), stream = file.createReadStream();
  const stop = () => stream.destroy(mediaAbortError());
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const data of stream) {
      abort(signal);
      hash2.update(data);
    }
    return hash2.digest("hex");
  } finally {
    stream.destroy();
    await file.close();
    signal.removeEventListener("abort", stop);
  }
}
async function readBytes(root, parts, maximum) {
  const path = await regular(root, parts), file = await open(path, constants4.O_RDONLY | (constants4.O_NOFOLLOW ?? 0));
  try {
    if ((await file.stat()).size > maximum)
      throw new EditorTaskError("LIMIT_EXCEEDED", "保存的任务数据超过大小限制");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function readPrefix(root, parts, length = 32) {
  const path = await regular(root, parts), file = await open(path, constants4.O_RDONLY | (constants4.O_NOFOLLOW ?? 0));
  try {
    const result = Buffer.alloc(length), { bytesRead } = await file.read(result, 0, length, 0);
    return result.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
async function json(root, parts, maximum = 65536) {
  return JSON.parse((await readBytes(root, parts, maximum)).toString("utf8"));
}
async function optionalJson(root, parts, maximum) {
  try {
    return await json(root, parts, maximum);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function atomic(path, bytes) {
  const scratch = `${path}.${randomUUID3()}.tmp`, file = await open(scratch, "wx", 384);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename2(scratch, path);
  } finally {
    await rm5(scratch, { force: true });
  }
}
async function publish(root, path, extension, mimeType, role, signal) {
  abort(signal);
  const sha2562 = await fileHash(path, signal), bytes = (await stat5(path)).size;
  if (bytes < 1 || bytes > 20 * 1024 ** 3)
    throw new EditorTaskError("LIMIT_EXCEEDED", "输出文件超过当前资源接口的 20GiB 限制");
  const outputs = await directory(root, ["outputs"]), target = join6(outputs, `${sha2562}.${extension}`);
  if (path !== target)
    await copyFile2(path, target, constants4.COPYFILE_EXCL).catch(async (error) => {
      if (error.code !== "EEXIST" || await fileHash(await regular(outputs, [`${sha2562}.${extension}`]), signal) !== sha2562)
        throw error;
    });
  return {
    file: relative2(root, target).split(sep2).join("/"),
    role,
    name: `${role}.${extension}`,
    mimeType,
    bytes,
    sha256: sha2562,
    assetId: `asset-${sha2562}`
  };
}

// native/editor-runtime/bundle.ts
var yauzl = __toESM(require_yauzl(), 1);
var yazl = __toESM(require_yazl(), 1);
import {
  constants as constants5,
  createWriteStream,
  open as openFd,
  close as closeFd,
  fstat as statFd
} from "node:fs";
import { link as link2, lstat as lstat2, open as open2, rm as rm6 } from "node:fs/promises";
import { createHash as createHash3, randomUUID as randomUUID4 } from "node:crypto";
import { dirname as dirname4, isAbsolute as isAbsolute5, join as join7, relative as relative3, sep as sep3 } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
/*! Bundled ZIP dependencies: yauzl / yazl (Copyright (c) 2014 Josh Wolfe),
 * buffer-crc32 (Copyright (c) 2013-2024 Brian J. Brennan), and pend / fd-slicer
 * (Copyright (c) 2014 Andrew Kelley). MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
var PORTABLE_BUNDLE_LIMITS = Object.freeze({
  maxManifestBytes: 32 * 1024 ** 2,
  maxMedia: MAX_PORTABLE_MEDIA,
  maxFileBytes: 20 * 1024 ** 3,
  maxTotalBytes: 20 * 1024 ** 3,
  maxArchiveBytes: 20 * 1024 ** 3,
  maxCompressionRatio: 1e3
});
var readerApi = yauzl;
var writerApi = yazl;
var fail = (code, message) => {
  throw new PortableProjectError(code, message);
};
function abort2(signal) {
  if (signal.aborted) throw new DOMException("工程包任务已取消", "AbortError");
}
function limitsFor(value = {}) {
  for (const key of Object.keys(value))
    if (!(key in PORTABLE_BUNDLE_LIMITS)) fail("INVALID_LIMIT", `未知工程包限制：${key}`);
  const result = { ...PORTABLE_BUNDLE_LIMITS, ...value };
  for (const key of Object.keys(result))
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > PORTABLE_BUNDLE_LIMITS[key])
      fail("INVALID_LIMIT", `工程包限制无效：${key}`);
  return result;
}
async function rootsFor(options2) {
  abort2(options2.signal);
  if (!options2.sourceRoots.length || options2.sourceRoots.length > 16)
    fail("INVALID_DIRECTORY", "必须提供 Host 材料目录白名单");
  return {
    root: await sealed(options2.workDir),
    roots: await Promise.all(options2.sourceRoots.map(sealed))
  };
}
async function sourcePath(path, roots) {
  if (!isAbsolute5(path)) fail("INVALID_FILE", "材料路径必须由 Host 物化");
  for (const root of roots) {
    const part2 = relative3(root, path);
    if (part2 && !isAbsolute5(part2) && part2 !== ".." && !part2.startsWith(`..${sep3}`))
      return regular(root, part2.split(sep3));
  }
  return fail("INVALID_FILE", "材料路径不在 Host 授权目录中");
}
async function outputPath(path, root) {
  if (!isAbsolute5(path)) fail("INVALID_FILE", "输出路径必须位于任务目录");
  const part2 = relative3(root, path);
  if (!part2 || isAbsolute5(part2) || part2 === ".." || part2.startsWith(`..${sep3}`))
    fail("INVALID_FILE", "输出路径不在任务目录内");
  const parts = part2.split(sep3), name = parts.pop();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) fail("INVALID_FILE", "输出文件名无效");
  const parent = await directory(root, parts), target = join7(parent, name);
  try {
    await lstat2(target);
  } catch (error) {
    if (error.code === "ENOENT") return target;
    throw error;
  }
  return fail("OUTPUT_EXISTS", "工程包输出文件已经存在");
}
var crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let i = 0; i < 8; i++) n = n & 1 ? 3988292384 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return crc;
}
async function inspectFile(path, maximum, signal) {
  abort2(signal);
  const hash2 = createHash3("sha256");
  let bytes = 0;
  const handle = await open2(path, constants5.O_RDONLY | constants5.O_NOFOLLOW);
  const stream = handle.createReadStream({ highWaterMark: 128 * 1024 });
  const stop = () => stream.destroy(new DOMException("工程包任务已取消", "AbortError"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of stream) {
      abort2(signal);
      bytes += chunk.length;
      if (bytes > maximum) fail("LIMIT_EXCEEDED", "原始素材超过工程包单文件限制");
      hash2.update(chunk);
    }
    if (!bytes) fail("INVALID_MEDIA", "原始素材为空文件");
    return { bytes, sha256: hash2.digest("hex") };
  } finally {
    stream.destroy();
    await handle.close();
    signal.removeEventListener("abort", stop);
  }
}
async function exportPortableProject(options2) {
  const document2 = validateEditorDocument(options2.document), limits = limitsFor(options2.limits);
  if (document2.assets.length > limits.maxMedia)
    fail("LIMIT_EXCEEDED", "工程素材数量超过工程包限制");
  const { root, roots } = await rootsFor(options2), target = await outputPath(options2.outputPath, root);
  const originals = document2.assets.filter((asset2) => asset2.kind !== "demo");
  const blobs = /* @__PURE__ */ new Map(), issues = [];
  let total = 0, checked = 0;
  for (const asset2 of originals) {
    abort2(options2.signal);
    try {
      const source2 = await options2.resolveAsset(structuredClone(asset2), options2.signal);
      abort2(options2.signal);
      const path = await sourcePath(source2.path, roots), actual = await inspectFile(path, limits.maxFileBytes, options2.signal);
      if (source2.bytes !== void 0 && source2.bytes !== actual.bytes || source2.sha256 !== void 0 && source2.sha256 !== actual.sha256 || asset2.fingerprint && asset2.fingerprint !== actual.sha256)
        fail("HASH_MISMATCH", "原始素材已变化或摘要不符");
      const previous = blobs.get(actual.sha256);
      if (previous) previous.assetIds.push(asset2.id);
      else {
        total += actual.bytes;
        blobs.set(actual.sha256, { ...actual, path, assetIds: [asset2.id] });
      }
    } catch (error) {
      abort2(options2.signal);
      issues.push({
        assetId: asset2.id,
        message: `${asset2.name}：${error instanceof Error ? error.message : String(error)}`
      });
    }
    options2.onProgress?.({
      phase: "checking",
      completed: ++checked,
      total: originals.length,
      bytes: total
    });
    if (total > limits.maxTotalBytes) fail("LIMIT_EXCEEDED", "工程素材总大小超过工程包限制");
  }
  if (issues.length)
    throw new PortableProjectError("MISSING_MEDIA", "原始素材不可用，未生成工程包", issues);
  if (total > limits.maxTotalBytes) fail("LIMIT_EXCEEDED", "工程素材总大小超过工程包限制");
  const files = [...blobs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
  const manifest = validatePortableProjectManifest({
    format: PORTABLE_PROJECT_FORMAT,
    formatVersion: PORTABLE_PROJECT_VERSION,
    document: document2,
    media: files.map(({ path: _, ...item }) => item)
  });
  const json3 = Buffer.from(JSON.stringify(manifest));
  if (json3.length > limits.maxManifestBytes || total + json3.length > limits.maxTotalBytes)
    fail("LIMIT_EXCEEDED", "工程清单或展开后总大小超过工程包限制");
  const scratch = join7(dirname4(target), `bundle-${randomUUID4()}.partial`), zip = new writerApi.ZipFile();
  const active = /* @__PURE__ */ new Set();
  const stopStreams = (error) => {
    for (const stream of active) stream.destroy(error);
  };
  const zipError = (error) => {
    zip.outputStream.destroy(error);
    stopStreams(error);
  };
  zip.on("error", zipError);
  const stop = () => zipError(new DOMException("工程包任务已取消", "AbortError"));
  options2.signal.addEventListener("abort", stop, { once: true });
  let completed = 0, packed = 0, archiveBytes = 0;
  const output = createWriteStream(scratch, { flags: "wx", mode: 384 });
  try {
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        archiveBytes += chunk.length;
        if (archiveBytes > limits.maxArchiveBytes)
          done(new PortableProjectError("LIMIT_EXCEEDED", "工程包超过输出大小限制"));
        else done(null, chunk);
      }
    });
    const finished = pipeline(zip.outputStream, counter, output, { signal: options2.signal });
    void finished.catch(() => {
    });
    const entryOptions = {
      compress: false,
      mtime: /* @__PURE__ */ new Date("2000-01-01T00:00:00Z"),
      mode: 33152,
      forceDosTimestamp: true
    };
    zip.addBuffer(json3, "manifest.json", entryOptions);
    for (const file of files)
      zip.addReadStreamLazy(
        portableMediaPath(file.sha256),
        { ...entryOptions, size: file.bytes },
        (provide) => {
          void (async () => {
            abort2(options2.signal);
            const path = await sourcePath(file.path, roots), hash2 = createHash3("sha256");
            let size = 0;
            const handle = await open2(path, constants5.O_RDONLY | constants5.O_NOFOLLOW);
            const source2 = handle.createReadStream({ highWaterMark: 128 * 1024 });
            const verify = new Transform({
              transform(chunk, _encoding, done) {
                size += chunk.length;
                if (size > file.bytes)
                  done(new PortableProjectError("HASH_MISMATCH", "打包期间原始素材大小发生变化"));
                else {
                  hash2.update(chunk);
                  done(null, chunk);
                }
              },
              flush(done) {
                if (size !== file.bytes || hash2.digest("hex") !== file.sha256)
                  done(new PortableProjectError("HASH_MISMATCH", "打包期间原始素材发生变化"));
                else {
                  try {
                    packed += size;
                    options2.onProgress?.({
                      phase: "packing",
                      completed: ++completed,
                      total: files.length,
                      bytes: packed
                    });
                    done();
                  } catch (error) {
                    done(error);
                  }
                }
              }
            });
            active.add(source2);
            active.add(verify);
            for (const stream of [source2, verify]) {
              stream.on("error", zipError);
              stream.once("close", () => active.delete(stream));
            }
            source2.pipe(verify);
            provide(null, verify);
          })().catch((error) => {
            provide(error);
            zipError(error);
          });
        }
      );
    zip.end();
    await finished;
    abort2(options2.signal);
    const persisted = await open2(scratch, constants5.O_RDWR | constants5.O_NOFOLLOW);
    try {
      await persisted.sync();
    } finally {
      await persisted.close();
    }
    const actual = await inspectFile(scratch, limits.maxArchiveBytes, options2.signal);
    abort2(options2.signal);
    await link2(scratch, target);
    return { manifest, path: target, ...actual };
  } finally {
    options2.signal.removeEventListener("abort", stop);
    stopStreams();
    zip.outputStream.destroy();
    await new Promise((resolve) => {
      if (output.closed) resolve();
      else {
        output.once("close", resolve);
        output.destroy();
      }
    });
    await rm6(scratch, { force: true });
  }
}
async function readEntry(zip, entry, signal, consume) {
  abort2(signal);
  const stream = await zip.openReadStreamPromise(entry);
  let bytes = 0, crc = 4294967295;
  const stop = () => stream.destroy(new DOMException("工程包任务已取消", "AbortError"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of stream) {
      abort2(signal);
      bytes += chunk.length;
      if (bytes > entry.uncompressedSize) fail("INVALID_ZIP", "ZIP 实际解压大小超过清单");
      crc = crcUpdate(crc, chunk);
      await consume(chunk);
    }
    if (bytes !== entry.uncompressedSize || (crc ^ 4294967295) >>> 0 !== entry.crc32)
      fail("INVALID_ZIP", "ZIP 内容大小或 CRC 校验失败");
  } finally {
    stream.destroy();
    signal.removeEventListener("abort", stop);
  }
}
async function importPortableProject(options2) {
  const limits = limitsFor(options2.limits), { root, roots } = await rootsFor(options2);
  const input = await sourcePath(options2.inputPath, roots);
  const fd = await new Promise(
    (resolve, reject) => openFd(
      input,
      constants5.O_RDONLY | constants5.O_NOFOLLOW,
      (error, fd2) => error ? reject(error) : resolve(fd2)
    )
  );
  let zip, extraction, succeeded = false;
  try {
    const inputInfo = await new Promise(
      (resolve, reject) => statFd(fd, (error, info) => error ? reject(error) : resolve(info))
    );
    if (!inputInfo.isFile()) fail("INVALID_FILE", "工程包必须是普通文件");
    if (inputInfo.size > limits.maxArchiveBytes) fail("LIMIT_EXCEEDED", "工程包文件超过大小限制");
    zip = await readerApi.fromFdPromise(fd, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      decodeStrings: true,
      validateEntrySizes: true
    });
    let readerError;
    zip.on("error", (error) => {
      readerError = error;
    });
    const centralStart = zip.readEntryCursor;
    if (zip.entryCount > limits.maxMedia + 1) fail("LIMIT_EXCEEDED", "ZIP 条目数量超过限制");
    const entries = /* @__PURE__ */ new Map(), ranges = [];
    let expanded = 0;
    for await (const entry of zip.eachEntry()) {
      abort2(options2.signal);
      if (entries.size >= limits.maxMedia + 1) fail("LIMIT_EXCEEDED", "ZIP 条目数量超过限制");
      if (entry.fileName !== "manifest.json" && !/^media\/[a-f0-9]{64}$/.test(entry.fileName))
        fail("INVALID_ZIP", `ZIP 包含不支持的路径：${entry.fileName}`);
      if (entries.has(entry.fileName)) fail("INVALID_ZIP", `ZIP 路径重复：${entry.fileName}`);
      const type = entry.externalFileAttributes >>> 16 & 61440;
      if (type !== 0 && type !== 32768 || entry.externalFileAttributes & 16)
        fail("INVALID_ZIP", "ZIP 只能包含普通文件，不能包含符号链接或目录");
      if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
        fail("INVALID_ZIP", "不支持加密或此压缩方式的 ZIP");
      const maximum = entry.fileName === "manifest.json" ? limits.maxManifestBytes : limits.maxFileBytes;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > maximum || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 1 || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)
        fail("LIMIT_EXCEEDED", "ZIP 文件大小或压缩比超过限制");
      expanded += entry.uncompressedSize;
      if (expanded > limits.maxTotalBytes) fail("LIMIT_EXCEEDED", "ZIP 展开后总大小超过限制");
      const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
      if (!local.fileName.equals(Buffer.from(entry.fileName)) || local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag)
        fail("INVALID_ZIP", "ZIP 本地头与目录记录不一致");
      const end = local.fileDataStart + entry.compressedSize;
      if (!Number.isSafeInteger(end) || entry.relativeOffsetOfLocalHeader < 0 || end > centralStart)
        fail("INVALID_ZIP", "ZIP 文件数据边界无效");
      ranges.push([entry.relativeOffsetOfLocalHeader, end]);
      entries.set(entry.fileName, entry);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1][1]))
      fail("INVALID_ZIP", "ZIP 文件内容区间重叠");
    const manifestEntry = entries.get("manifest.json");
    if (!manifestEntry) fail("INVALID_BUNDLE", "ZIP 缺少根 manifest.json");
    const chunks = [];
    await readEntry(zip, manifestEntry, options2.signal, async (chunk) => {
      chunks.push(chunk);
    });
    let raw;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      fail("INVALID_BUNDLE", "工程包清单不是有效的 UTF-8 JSON");
    }
    const manifest = validatePortableProjectManifest(raw);
    const missing = manifest.media.filter((item) => !entries.has(portableMediaPath(item.sha256)));
    if (missing.length)
      throw new PortableProjectError(
        "MISSING_MEDIA",
        "工程包缺少素材文件",
        missing.map((item) => ({
          sha256: item.sha256,
          message: `缺少 ${portableMediaPath(item.sha256)}`
        }))
      );
    if (entries.size !== manifest.media.length + 1)
      fail("INVALID_BUNDLE", "ZIP 含有清单未引用的素材");
    for (const item of manifest.media)
      if (entries.get(portableMediaPath(item.sha256)).uncompressedSize !== item.bytes)
        fail("HASH_MISMATCH", "素材大小与工程清单不符");
    extraction = await directory(root, [`bundle-import-${randomUUID4()}`]);
    const mediaRoot = await directory(extraction, ["media"]), media = [];
    let extracted = 0;
    for (const item of manifest.media) {
      abort2(options2.signal);
      const path = join7(mediaRoot, item.sha256), output = await open2(path, "wx", 384), hash2 = createHash3("sha256");
      try {
        await readEntry(
          zip,
          entries.get(portableMediaPath(item.sha256)),
          options2.signal,
          async (chunk) => {
            hash2.update(chunk);
            await output.writeFile(chunk);
          }
        );
        if (hash2.digest("hex") !== item.sha256)
          fail("HASH_MISMATCH", `素材 SHA-256 校验失败：${item.sha256}`);
        await output.sync();
      } finally {
        await output.close();
      }
      media.push({ ...item, assetIds: [...item.assetIds], path });
      extracted += item.bytes;
      options2.onProgress?.({
        phase: "unpacking",
        completed: media.length,
        total: manifest.media.length,
        bytes: extracted
      });
    }
    abort2(options2.signal);
    if (readerError) throw readerError;
    succeeded = true;
    return { manifest, document: structuredClone(manifest.document), directory: extraction, media };
  } catch (error) {
    if (error instanceof PortableProjectError || error instanceof Error && error.name === "AbortError")
      throw error;
    throw new PortableProjectError(
      "INVALID_ZIP",
      `工程包读取失败：${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (zip)
      await new Promise((resolve) => {
        zip.once("close", resolve);
        zip.close();
      });
    else await new Promise((resolve) => closeFd(fd, () => resolve()));
    if (!succeeded && extraction) await rm6(extraction, { recursive: true, force: true });
  }
}

// native/editor-runtime/bundle-tasks.ts
import { rm as rm7, stat as stat6, open as open3, link as link3 } from "node:fs/promises";
import { basename, join as join8 } from "node:path";
import { randomUUID as randomUUID5 } from "node:crypto";
var PORTABLE_PUBLICATION_BATCH = 120;
function checkedReceipt(value) {
  const receipt = value;
  if (!receipt || receipt.schemaVersion !== 1 || !/^bundle-import-[a-f0-9-]{36}$/.test(receipt.directory) || !Number.isSafeInteger(receipt.manifestBytes) || receipt.manifestBytes < 1 || receipt.manifestBytes > 32 * 1024 ** 2)
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包暂存回执无效，请重新导入");
  hash(receipt.bundleHash);
  hash(receipt.manifestHash);
  resourceId(receipt.sourceResourceId);
  if (!Number.isSafeInteger(receipt.mediaCount) || receipt.mediaCount < 0 || receipt.mediaCount > 1e4 || !Array.isArray(receipt.pages) || receipt.pages.length !== Math.ceil(receipt.mediaCount / PORTABLE_PUBLICATION_BATCH))
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包批次回执无效");
  for (const page of receipt.pages) {
    hash(page.sha256);
    if (!Number.isSafeInteger(page.bytes) || page.bytes < 1 || page.bytes > 128 * 1024)
      throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包批次大小无效");
  }
  return receipt;
}
async function loadManifest(base, receipt) {
  const data = await readBytes(base, [receipt.directory, "manifest.json"], 32 * 1024 ** 2);
  if (data.length !== receipt.manifestBytes || bytesHash(data) !== receipt.manifestHash)
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包暂存清单已变化，请重新导入");
  return validatePortableProjectManifest(
    JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(data))
  );
}
function mediaMime(manifest, assetIds) {
  const types = new Set(
    assetIds.map((id3) => {
      const asset2 = manifest.document.assets.find((asset3) => asset3.id === id3);
      const mime = asset2?.metadata?.mimeType ?? asset2?.metadata?.sourceMimeType;
      return typeof mime === "string" && /^(?:image|audio|video)\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime) ? mime : "application/octet-stream";
    })
  );
  return types.size === 1 ? [...types][0] : "application/octet-stream";
}
async function runPortableImportRequest(request, context) {
  const base = await directory(context.transfer, ["portable-import"]);
  const discarded = await optionalJson(base, ["discarded.json"]);
  if (discarded) {
    if (request.action === "discard-project-import" && discarded.bundleHash === request.bundleHash)
      return { discarded: true, transferId: request.transferId, bundleHash: request.bundleHash };
    throw new EditorTaskError("IMPORT_DISCARDED", "此工程包暂存已释放，请开始新的导入");
  }
  let receipt = await optionalJson(base, ["receipt.json"]);
  if (request.action === "import-project") {
    const sourceResourceId = request.resourceIds[0];
    if (receipt) {
      receipt = checkedReceipt(receipt);
      if (receipt.sourceResourceId !== sourceResourceId)
        throw new EditorTaskError("IMPORT_MISMATCH", "同一导入暂存不能改用另一个工程包");
    } else {
      const input = await regular(context.root, ["inputs", "resource-0.bin"]);
      const before = await stat6(input), bundleHash = await fileHash(input, context.signal);
      if (sourceResourceId.startsWith("asset-") && sourceResourceId !== `asset-${bundleHash}`)
        throw new EditorTaskError("SOURCE_CHANGED", "工程包内容与资源编号不匹配");
      let progressFailure;
      const imported = await importPortableProject({
        inputPath: input,
        sourceRoots: [context.root],
        workDir: base,
        signal: context.signal,
        onProgress: (item) => {
          void context.progress(item.total ? item.completed / item.total * 0.9 : 0.9, "import-project").catch((error) => {
            progressFailure ??= error;
          });
        }
      });
      let published = false;
      try {
        if (progressFailure) throw progressFailure;
        const after = await stat6(input);
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
          throw new EditorTaskError("SOURCE_CHANGED", "工程包在读取时发生变化，请重新导入");
        const bytes = Buffer.from(JSON.stringify(imported.manifest));
        const pages = [];
        for (let index = 0; index < imported.manifest.media.length; index += PORTABLE_PUBLICATION_BATCH) {
          const items = imported.manifest.media.slice(index, index + PORTABLE_PUBLICATION_BATCH).map((item) => ({
            sha256: item.sha256,
            bytes: item.bytes,
            mimeType: mediaMime(imported.manifest, item.assetIds)
          }));
          const data = Buffer.from(JSON.stringify(items));
          await atomic(join8(imported.directory, `page-${pages.length}.json`), data);
          pages.push({ sha256: bytesHash(data), bytes: data.length });
        }
        receipt = {
          schemaVersion: 1,
          bundleHash,
          sourceResourceId,
          directory: basename(imported.directory),
          manifestHash: bytesHash(bytes),
          manifestBytes: bytes.length,
          mediaCount: imported.manifest.media.length,
          pages
        };
        await atomic(join8(imported.directory, "manifest.json"), bytes);
        abort(context.signal);
        const temporary = join8(base, `receipt-${randomUUID5()}.tmp`), file = await open3(temporary, "wx", 384);
        try {
          await file.writeFile(JSON.stringify(receipt));
          await file.sync();
        } finally {
          await file.close();
        }
        try {
          await link3(temporary, join8(base, "receipt.json"));
          published = true;
        } finally {
          await rm7(temporary, { force: true });
        }
      } finally {
        if (!published) await rm7(imported.directory, { recursive: true, force: true });
      }
    }
  }
  if (!receipt)
    throw new EditorTaskError("IMPORT_NOT_READY", "工程包尚未完整校验，请先导入原始工程包");
  receipt = checkedReceipt(receipt);
  if (request.bundleHash && request.bundleHash !== receipt.bundleHash)
    throw new EditorTaskError("IMPORT_MISMATCH", "请求与已校验的工程包不一致");
  if (request.action === "discard-project-import") {
    await atomic(
      join8(base, "discarded.json"),
      Buffer.from(JSON.stringify({ bundleHash: receipt.bundleHash }))
    );
    await rm7(join8(base, receipt.directory), { recursive: true, force: true });
    await rm7(join8(base, "receipt.json"), { force: true });
    return { discarded: true, transferId: request.transferId, bundleHash: receipt.bundleHash };
  }
  if (request.action === "publish-project-media") {
    const page = receipt.pages[request.batchIndex];
    if (!page) throw new EditorTaskError("INVALID_REQUEST", "工程包素材批次不存在");
    const data = await readBytes(
      base,
      [receipt.directory, `page-${request.batchIndex}.json`],
      128 * 1024
    );
    if (data.length !== page.bytes || bytesHash(data) !== page.sha256)
      throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包素材批次回执已变化");
    const batch = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(data)), media = [];
    if (!Array.isArray(batch) || batch.length !== Math.min(
      PORTABLE_PUBLICATION_BATCH,
      receipt.mediaCount - request.batchIndex * PORTABLE_PUBLICATION_BATCH
    ))
      throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包素材批次不完整");
    for (const item of batch) {
      abort(context.signal);
      const path = await regular(base, [receipt.directory, "media", item.sha256]);
      if ((await stat6(path)).size !== item.bytes)
        throw new EditorTaskError("SOURCE_CHANGED", "已校验的暂存素材发生变化，请重新导入");
      const artifact2 = await context.add(path, "bin", item.mimeType, "portable-media");
      if (artifact2.sha256 !== item.sha256 || artifact2.bytes !== item.bytes)
        throw new EditorTaskError("SOURCE_CHANGED", "发布素材时内容发生变化");
      media.push(artifact2);
      await context.progress(media.length / batch.length, "publish-project-media");
    }
    return {
      transferId: request.transferId,
      bundleHash: receipt.bundleHash,
      batchIndex: request.batchIndex,
      media
    };
  }
  await loadManifest(base, receipt);
  const artifact = await context.add(
    await regular(base, [receipt.directory, "manifest.json"]),
    "json",
    "application/json",
    "portable-manifest"
  );
  if (artifact.sha256 !== receipt.manifestHash)
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "发布的工程清单校验失败");
  await context.progress(1, "complete");
  return {
    transferId: request.transferId,
    sourceResourceId: receipt.sourceResourceId,
    bundleHash: receipt.bundleHash,
    manifest: artifact,
    mediaCount: receipt.mediaCount
  };
}
function portableTaskError(error) {
  if (error instanceof PortableProjectError) {
    const detail = error.issues.slice(0, 5).map((issue) => issue.message.slice(0, 120)).join("；");
    throw new EditorTaskError(
      error.code,
      `${error.message}${detail ? `：${detail}${error.issues.length > 5 ? `；另有 ${error.issues.length - 5} 项` : ""}` : ""}`,
      false
    );
  }
  throw error;
}

// native/editor-runtime/waveform.ts
import { createReadStream as createReadStream3 } from "node:fs";
import { lstat as lstat3, readFile } from "node:fs/promises";
import { join as join9 } from "node:path";
var RATE2 = 48e3;
var MAX_SAMPLES = RATE2 * WAVEFORM_LIMITS.seconds;
var safety = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac"
];
var empty = () => ({ min: Infinity, max: -Infinity, squares: 0, count: 0 });
var WaveformAccumulator = class {
  bins = [];
  current = empty();
  tail = Buffer.alloc(0);
  samplesPerBin = 960;
  sampleCount = 0;
  push(bytes) {
    const data = this.tail.length ? Buffer.concat([this.tail, bytes]) : bytes;
    const length = data.length - data.length % 8;
    for (let offset = 0; offset < length; offset += 8) {
      if (++this.sampleCount > MAX_SAMPLES)
        throw new EditorTaskError("LIMIT_EXCEEDED", "波形分析最多支持 24 小时音频");
      const left = data.readFloatLE(offset), right = data.readFloatLE(offset + 4);
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.max(Math.abs(left), Math.abs(right)) > 1e6)
        throw new EditorTaskError("INVALID_AUDIO", "音频解码包含无效采样");
      this.current.min = Math.min(this.current.min, left, right);
      this.current.max = Math.max(this.current.max, left, right);
      this.current.squares += left * left + right * right;
      this.current.count++;
      if (this.current.count === this.samplesPerBin) {
        this.bins.push(this.current);
        this.current = empty();
        if (this.bins.length === WAVEFORM_LIMITS.bins) {
          const compact = [];
          for (let i = 0; i < this.bins.length; i += 2) {
            const a = this.bins[i], b = this.bins[i + 1];
            compact.push({
              min: Math.min(a.min, b.min),
              max: Math.max(a.max, b.max),
              squares: a.squares + b.squares,
              count: a.count + b.count
            });
          }
          this.bins = compact;
          this.samplesPerBin *= 2;
        }
      }
    }
    this.tail = Buffer.from(data.subarray(length));
  }
  finish(sourceHash, hasAudio = true) {
    if (this.tail.length || hasAudio && !this.sampleCount)
      throw new EditorTaskError("INVALID_AUDIO", "音频解码未得到完整采样");
    const bins = this.current.count ? [...this.bins, this.current] : this.bins;
    let peakScale = 1;
    for (const bin of bins) peakScale = Math.max(peakScale, Math.abs(bin.min), Math.abs(bin.max));
    const data = Buffer.alloc(bins.length * 6), scale = 32767 / peakScale;
    bins.forEach((bin, i) => {
      data.writeInt16LE(Math.round(bin.min * scale), i * 6);
      data.writeInt16LE(Math.round(bin.max * scale), i * 6 + 2);
      data.writeInt16LE(Math.round(Math.sqrt(bin.squares / (bin.count * 2)) * scale), i * 6 + 4);
    });
    return {
      schemaVersion: 1,
      sourceHash,
      sampleRate: RATE2,
      channels: 2,
      hasAudio,
      sampleCount: this.sampleCount,
      samplesPerBin: this.samplesPerBin,
      peakScale,
      peaksBase64: data.toString("base64")
    };
  }
};
async function analyzeEditorWaveform(options2) {
  const { input, signal } = options2;
  abort(signal);
  const sourceHash = await fileHash(input, signal);
  const version = (await runMediaProcess(options2.ffmpegPath, ["-hide_banner", "-version"], {
    signal,
    maxStdoutBytes: 65536
  })).stdout.toString();
  const recipeHash = digest2({ algorithm: "stereo-envelope-v1", sourceHash, decoder: version });
  const path = join9(options2.cacheDir, `${recipeHash}.json`);
  try {
    const cached = await regular(options2.cacheDir, [`${recipeHash}.json`]);
    if ((await lstat3(cached)).size > WAVEFORM_LIMITS.bytes)
      throw new EditorTaskError("INVALID_CACHE", "波形缓存超出大小限制");
    const waveform2 = decodeEditorWaveform(JSON.parse(await readFile(cached, "utf8")));
    if (waveform2.sourceHash !== sourceHash)
      throw new EditorTaskError("INVALID_CACHE", "波形缓存与素材不匹配");
    return { path, sourceHash, recipeHash, reused: true, reusedPcm: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const probe = JSON.parse(
    (await runMediaProcess(
      options2.ffprobePath,
      [
        "-v",
        "error",
        ...safety,
        "-show_entries",
        "format=start_time,duration:stream=codec_type,start_time,duration",
        "-of",
        "json",
        input
      ],
      { signal, maxStdoutBytes: 1024 * 1024 }
    )).stdout.toString()
  );
  if (!Array.isArray(probe.streams)) throw new EditorTaskError("INVALID_AUDIO", "音频信息无效");
  const audio2 = probe.streams.find((s) => s.codec_type === "audio");
  const accumulator = new WaveformAccumulator();
  let reusedPcm = false;
  if (audio2) {
    const origin = Number(probe.format?.start_time ?? 0), end = Number(audio2.start_time ?? origin) - origin + Number(audio2.duration);
    if (Number.isFinite(end) && end > WAVEFORM_LIMITS.seconds)
      throw new EditorTaskError("LIMIT_EXCEEDED", "波形分析最多支持 24 小时音频");
    const basename4 = `${editorSourcePcmCacheKey(sourceHash, options2.sourceDuration, version)}.f32`;
    let pcm;
    try {
      const candidate = await regular(options2.pcmCacheDir, [basename4]), size = (await lstat3(candidate)).size;
      if (Number.isFinite(end) && end > 0 && size % 8 === 0 && size / 8 >= Math.ceil(end * RATE2) - 1 && options2.sourceDuration / 24e4 + 1 > end && size / 8 <= MAX_SAMPLES)
        pcm = candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (pcm) {
      const stream = createReadStream3(pcm), cancel = () => stream.destroy(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      try {
        abort(signal);
        for await (const bytes of stream) {
          abort(signal);
          accumulator.push(bytes);
        }
        reusedPcm = true;
      } finally {
        signal.removeEventListener("abort", cancel);
        stream.destroy();
      }
    } else {
      await runMediaProcess(
        options2.ffmpegPath,
        [
          "-nostdin",
          "-v",
          "error",
          ...safety,
          "-copyts",
          "-start_at_zero",
          "-i",
          input,
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          "-af",
          "aresample=48000:async=1:first_pts=0",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "pipe:1"
        ],
        { signal, progressStream: "stderr", onStdout: (bytes) => accumulator.push(bytes) }
      );
    }
  }
  abort(signal);
  if (await fileHash(input, signal) !== sourceHash)
    throw new EditorTaskError("SOURCE_CHANGED", "素材在波形分析时发生变化");
  const waveform = accumulator.finish(sourceHash, !!audio2);
  decodeEditorWaveform(waveform);
  await atomic(path, Buffer.from(JSON.stringify(waveform)));
  abort(signal);
  return { path, sourceHash, recipeHash, reused: false, reusedPcm };
}

// native/editor-runtime/multicam.ts
import { createReadStream as createReadStream4 } from "node:fs";
import { readFile as readFile2, stat as stat7 } from "node:fs/promises";
import { join as join10 } from "node:path";

// src/editor/audio-correlation.ts
function fft(real, imag, inverse) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let begin = 0; begin < n; begin += size) {
      let ur = 1, ui = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = begin + j, b = a + size / 2, vr = real[b] * ur - imag[b] * ui, vi = real[b] * ui + imag[b] * ur;
        real[b] = real[a] - vr;
        imag[b] = imag[a] - vi;
        real[a] += vr;
        imag[a] += vi;
        const nr = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = nr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
}
function sums(values) {
  const sum = new Float64Array(values.length + 1), squares = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) {
    sum[i + 1] = sum[i] + values[i];
    squares[i + 1] = squares[i] + values[i] * values[i];
  }
  return [sum, squares];
}
function correlateAudioFeatures(reference, target, maxLag, minOverlap = 400) {
  if (![reference, target].every(
    (values) => values instanceof Float32Array && values.length >= minOverlap && values.length <= 36e3 && values.every(Number.isFinite)
  ) || !Number.isSafeInteger(maxLag) || maxLag < 0 || maxLag > 12e3 || !Number.isSafeInteger(minOverlap) || minOverlap < 200)
    throw new Error("音频相关分析范围无效，至少需要一段完整声音");
  let n = 1;
  while (n < reference.length + target.length - 1) n *= 2;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  for (let i = 0; i < reference.length; i++) ar[i] = reference[reference.length - 1 - i];
  br.set(target);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const real = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = real;
  }
  fft(ar, ai, true);
  const [rs, rq] = sums(reference), [ts, tq] = sums(target), candidates = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const r0 = Math.max(0, -lag), r1 = Math.min(reference.length, target.length - lag), count = r1 - r0;
    if (count < minOverlap) continue;
    const t0 = r0 + lag, t1 = r1 + lag, sa = rs[r1] - rs[r0], sb = ts[t1] - ts[t0], va = rq[r1] - rq[r0] - sa * sa / count, vb = tq[t1] - tq[t0] - sb * sb / count;
    if (va / count < 1e-5 || vb / count < 1e-5) continue;
    const dot = ar[reference.length - 1 + lag], score = Math.max(-1, Math.min(1, (dot - sa * sb / count) / Math.sqrt(va * vb)));
    candidates.push({ lag, score, overlap: count });
  }
  candidates.sort(
    (a, b) => b.score - a.score || b.overlap - a.overlap || Math.abs(a.lag) - Math.abs(b.lag)
  );
  const best = candidates[0];
  if (!best)
    return {
      lag: 0,
      confidence: 0,
      secondPeak: 0,
      overlap: 0,
      reliable: false,
      reason: "声音静音或缺少可辨认的变化，请手动对齐"
    };
  const second = candidates.find((item) => Math.abs(item.lag - best.lag) > 20)?.score ?? 0;
  const reliable = best.score >= 0.65 && best.score - second >= 0.075 && !(maxLag > 0 && Math.abs(best.lag) === maxLag);
  const reason = best.score < 0.65 ? "两段声音相似度不足，请选择包含共同声音的分析范围" : best.score - second < 0.075 ? "声音存在重复节奏或多个相近匹配，请手动确认偏移" : Math.abs(best.lag) === maxLag && maxLag > 0 ? "最佳匹配位于搜索边界，请扩大最大偏移" : void 0;
  return {
    lag: best.lag,
    confidence: Math.max(0, best.score),
    secondPeak: Math.max(0, second),
    overlap: best.overlap,
    reliable,
    ...reason ? { reason } : {}
  };
}

// native/editor-runtime/multicam.ts
var safety2 = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac"
];
var RATE3 = 48e3;
var BIN = 240;
var Features = class {
  constructor(maxSamples) {
    this.maxSamples = maxSamples;
  }
  maxSamples;
  values = [];
  tail = Buffer.alloc(0);
  count = 0;
  squares = 0;
  total = 0;
  push(bytes) {
    const data = this.tail.length ? Buffer.concat([this.tail, bytes]) : bytes, length = data.length - data.length % 8;
    for (let at = 0; at < length; at += 8) {
      if (this.total++ >= this.maxSamples) break;
      const left = data.readFloatLE(at), right = data.readFloatLE(at + 4);
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.max(Math.abs(left), Math.abs(right)) > 1e6)
        throw new EditorTaskError("INVALID_AUDIO", "机位声音包含无效采样");
      this.squares += left * left + right * right;
      this.count++;
      if (this.count === BIN) {
        this.values.push(Math.log1p(1e3 * Math.sqrt(this.squares / (2 * this.count))));
        this.squares = 0;
        this.count = 0;
      }
    }
    this.tail = Buffer.from(data.subarray(length));
  }
  finish() {
    if (this.tail.length) throw new EditorTaskError("INVALID_AUDIO", "机位声音采样不完整");
    return Float32Array.from(this.values);
  }
};
async function alignEditorMulticam(options2) {
  const { signal } = options2;
  abort(signal);
  if (options2.sources.length < 2 || options2.sources.length > 32 || !Number.isFinite(options2.windowSeconds) || options2.windowSeconds < 3 || options2.windowSeconds > 180 || !Number.isFinite(options2.maxOffsetSeconds) || options2.maxOffsetSeconds < 0 || options2.maxOffsetSeconds > 60 || options2.maxOffsetSeconds >= options2.windowSeconds - 2)
    throw new EditorTaskError(
      "INVALID_REQUEST",
      "对齐分析需要 3 至 180 秒，最大偏移小于分析时长减 2 秒"
    );
  if (new Set(options2.sources.map((source2) => source2.resourceId)).size !== options2.sources.length || !options2.sources.some((source2) => source2.resourceId === options2.referenceResourceId))
    throw new EditorTaskError("INVALID_REQUEST", "对齐机位列表或基准机位无效");
  const version = (await runMediaProcess(options2.ffmpegPath, ["-hide_banner", "-version"], {
    signal,
    maxStdoutBytes: 65536
  })).stdout.toString();
  const decoded = [];
  for (const source2 of options2.sources) {
    abort(signal);
    const sourceHash = await fileHash(source2.path, signal), key = digest2({
      algorithm: "stereo-log-energy-5ms-v1",
      sourceHash,
      windowSeconds: options2.windowSeconds,
      decoder: version
    }), path = join10(options2.cacheDir, `${key}.json`);
    try {
      const cached = await regular(options2.cacheDir, [`${key}.json`]);
      if ((await stat7(cached)).size > 1024 * 1024) throw new Error("机位缓存超过范围");
      const value = JSON.parse(await readFile2(cached, "utf8"));
      if (value.sourceHash !== sourceHash || !Array.isArray(value.features) || value.features.length < 400 || value.features.length > 36e3 || !value.features.every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 30
      ))
        throw new Error("机位声音缓存无效");
      decoded.push({
        source: source2,
        sourceHash,
        features: Float32Array.from(value.features),
        reused: true
      });
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const accumulator = new Features(Math.floor(options2.windowSeconds * RATE3));
    const pcmKey = editorSourcePcmCacheKey(sourceHash, source2.duration, version);
    let usedPcm = false;
    try {
      const pcm = await regular(options2.pcmCacheDir, [`${pcmKey}.f32`]), info = await stat7(pcm);
      if (info.size % 8 !== 0 || info.size < RATE3 * 2 * 8)
        throw new Error("声音缓存不完整或不足两秒");
      const stream = createReadStream4(pcm, {
        start: 0,
        end: Math.min(info.size, options2.windowSeconds * RATE3 * 8) - 1
      });
      const cancel = () => stream.destroy(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      try {
        for await (const bytes of stream) {
          abort(signal);
          accumulator.push(bytes);
        }
        usedPcm = true;
      } finally {
        signal.removeEventListener("abort", cancel);
        stream.destroy();
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!usedPcm) {
      const probe = JSON.parse(
        (await runMediaProcess(
          options2.ffprobePath,
          [
            "-v",
            "error",
            ...safety2,
            "-show_entries",
            "stream=codec_type",
            "-of",
            "json",
            source2.path
          ],
          { signal, maxStdoutBytes: 1024 * 1024 }
        )).stdout.toString()
      );
      if (!probe.streams?.some((stream) => stream.codec_type === "audio"))
        throw new EditorTaskError("NO_AUDIO", "所选机位没有可用于同步的声音，请手动设置偏移");
      await runMediaProcess(
        options2.ffmpegPath,
        [
          "-v",
          "error",
          "-nostdin",
          ...safety2,
          "-copyts",
          "-start_at_zero",
          "-i",
          source2.path,
          "-map",
          "0:a:0",
          "-vn",
          "-af",
          "aresample=48000:async=1:first_pts=0",
          "-ac",
          "2",
          "-t",
          String(options2.windowSeconds),
          "-c:a",
          "pcm_f32le",
          "-f",
          "f32le",
          "pipe:1"
        ],
        { signal, maxStdoutBytes: 0, onStdout: (bytes) => accumulator.push(bytes) }
      );
    }
    const features = accumulator.finish();
    if (features.length < 400)
      throw new EditorTaskError("SHORT_AUDIO", "机位共同声音至少需要 2 秒");
    abort(signal);
    if (await fileHash(source2.path, signal) !== sourceHash)
      throw new EditorTaskError("SOURCE_CHANGED", "机位素材在声音分析期间发生变化");
    await atomic(path, Buffer.from(JSON.stringify({ sourceHash, features: Array.from(features) })));
    decoded.push({ source: source2, sourceHash, features, reused: false });
  }
  const reference = decoded.find((item) => item.source.resourceId === options2.referenceResourceId);
  const results = decoded.map((item) => {
    abort(signal);
    const referenceOnly = item === reference, result = referenceOnly ? { lag: 0, confidence: 1, secondPeak: 0, overlap: item.features.length, reliable: true } : correlateAudioFeatures(
      reference.features,
      item.features,
      Math.round(options2.maxOffsetSeconds * 200)
    );
    return {
      resourceId: item.source.resourceId,
      sourceHash: item.sourceHash,
      offset: result.lag * 1200,
      confidence: result.confidence,
      secondPeak: result.secondPeak,
      overlapSeconds: result.overlap / 200,
      precisionTicks: 1200,
      reliable: result.reliable,
      ...result.reason ? { reason: result.reason } : {}
    };
  });
  return {
    referenceResourceId: options2.referenceResourceId,
    reused: decoded.every((item) => item.reused),
    results
  };
}

// native/editor-runtime/inspect.ts
import { stat as stat9 } from "node:fs/promises";

// native/editor-runtime/proxy.ts
import { rename as rename3, rm as rm8 } from "node:fs/promises";
import { createHash as createHash4, randomUUID as randomUUID6 } from "node:crypto";
import { join as join11 } from "node:path";
var safety3 = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mpeg,mpegts,ogg"
];
var known = (value) => typeof value === "string" && !["unknown", "unspecified", "reserved"].includes(value) ? value : void 0;
function ratio(value) {
  if (typeof value !== "string" || !/^\d+[:/]\d+$/.test(value)) return 1;
  const [a, b] = value.split(/[:/]/).map(Number);
  return a > 0 && b > 0 ? a / b : 1;
}
async function timeline(path, streamIndex, origin, context, onFrame) {
  let pending = "", count = 0, previous = -1, firstTick2 = -1, endTick = -1;
  const hash2 = createHash4("sha256");
  const consume = (chunk) => {
    const lines = (pending + chunk.toString("utf8")).split(/\r?\n/);
    pending = lines.pop();
    if (pending.length > 4096) throw new EditorTaskError("INVALID_MEDIA", "视频帧时间数据无效");
    for (const line of lines) {
      const fields = Object.fromEntries(
        line.trim().split("|").map((field2) => field2.split("="))
      );
      if (!fields.best_effort_timestamp_time) continue;
      const seconds = Number(fields.best_effort_timestamp_time), tick2 = Math.round((seconds - origin) * 24e4);
      if (!Number.isFinite(seconds) || !Number.isSafeInteger(tick2) || tick2 < 0 || tick2 <= previous)
        throw new EditorTaskError(
          "UNSUPPORTED_TIMESTAMPS",
          "源视频存在缺失或重复的画面时间戳，请先修复素材"
        );
      if (firstTick2 < 0) firstTick2 = tick2;
      const duration = Number(fields.duration_time ?? fields.pkt_duration_time);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new EditorTaskError(
          "UNSUPPORTED_TIMESTAMPS",
          "源视频缺少准确的画面持续时间，请先修复素材"
        );
      endTick = Math.round((seconds - origin + duration) * 24e4);
      if (endTick > 86400 * 24e4)
        throw new EditorTaskError("LIMIT_EXCEEDED", "兼容画面最多支持 24 小时视频");
      previous = tick2;
      count++;
      hash2.update(`${tick2}
`);
      onFrame?.(count);
    }
  };
  await runMediaProcess(
    context.ffprobePath,
    [
      "-v",
      "error",
      ...safety3,
      "-select_streams",
      String(streamIndex),
      "-show_entries",
      "frame=best_effort_timestamp_time,duration_time,pkt_duration_time",
      "-of",
      "compact=p=0:nk=0",
      path
    ],
    { signal: context.signal, onStdout: consume }
  );
  consume(Buffer.from("\n"));
  if (!count) throw new EditorTaskError("INVALID_MEDIA", "源视频没有可解码画面");
  return { hash: hash2.digest("hex"), count, firstTick: firstTick2, endTick };
}
function describeEditorVideo(stream) {
  const trc = known(stream.color_transfer), primaries = known(stream.color_primaries), matrix = known(stream.color_space), range = known(stream.color_range);
  if (["smpte2084", "arib-std-b67"].includes(trc ?? "") || ["bt2020", "smpte431", "smpte432"].includes(primaries ?? "") || ["bt2020nc", "bt2020c"].includes(matrix ?? ""))
    throw new EditorTaskError(
      "UNSUPPORTED_HDR",
      "当前合成管线支持 SDR；HDR 或广色域素材需明确转换后导入"
    );
  if (/^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya)/.test(String(stream.pix_fmt)))
    throw new EditorTaskError(
      "UNSUPPORTED_ALPHA_VIDEO",
      "当前视频中间格式不支持透明通道，请先保留透明度导出为图片序列"
    );
  const rotation = Number(
    stream.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ?? stream.tags?.rotate ?? 0
  );
  if (!Number.isFinite(rotation) || Math.abs(rotation / 90 - Math.round(rotation / 90)) > 1e-5)
    throw new EditorTaskError("UNSUPPORTED_ORIENTATION", "源视频方向元数据不是直角旋转");
  const sar = ratio(stream.sample_aspect_ratio), unrotatedWidth = Math.round(stream.width * sar), rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const width = rotated ? stream.height : unrotatedWidth, height = rotated ? unrotatedWidth : stream.height;
  if (width < 1 || height < 1 || width > 8192 || height > 8192)
    throw new EditorTaskError("LIMIT_EXCEEDED", "源视频显示尺寸超过当前 8192 像素合成上限");
  const assumptions = [], sd = stream.height <= 576;
  const inputMatrix = matrix ?? (sd ? "smpte170m" : "bt709"), inputPrimaries = primaries ?? (sd ? "smpte170m" : "bt709"), inputTransfer = trc ?? "bt709", inputRange = range ?? "tv";
  if (!matrix) assumptions.push(`未标记色彩矩阵，使用${inputMatrix}`);
  if (!primaries) assumptions.push(`未标记色彩原色，使用${inputPrimaries}`);
  if (!trc) assumptions.push("未标记传递函数，使用bt709");
  if (!range) assumptions.push("未标记视频范围，使用limited");
  if (!["bt709", "bt470bg", "smpte170m", "smpte240m", "gbr"].includes(inputMatrix) || !["bt709", "bt470bg", "bt470m", "smpte170m", "smpte240m"].includes(inputPrimaries) || !["bt709", "iec61966-2-1", "gamma22", "gamma28", "smpte170m", "smpte240m"].includes(
    inputTransfer
  ) || !["pc", "tv"].includes(inputRange))
    throw new EditorTaskError(
      "UNSUPPORTED_COLOR",
      "源素材色彩描述尚不支持，请先明确转换为 SDR Rec.709"
    );
  const sourceBitDepth = Number(stream.bits_per_raw_sample) || Number(/p(\d+)(?:le|be)$/.exec(String(stream.pix_fmt))?.[1]) || 8;
  return {
    rotation,
    sar,
    width,
    height,
    assumptions,
    inputMatrix,
    inputPrimaries,
    inputTransfer,
    inputRange,
    sourceBitDepth
  };
}
async function prepareEditorProxy(path, sourceHash, context, purpose = "export") {
  const probe = JSON.parse(
    (await runMediaProcess(
      context.ffprobePath,
      ["-v", "error", ...safety3, "-show_streams", "-show_format", "-of", "json", path],
      { signal: context.signal }
    )).stdout.toString()
  );
  const stream = probe.streams?.find(
    (item) => item.codec_type === "video" && !item.disposition?.attached_pic
  );
  if (!stream || !Number.isInteger(stream.index) || !Number.isInteger(stream.width) || !Number.isInteger(stream.height))
    throw new EditorTaskError("INVALID_MEDIA", "视频素材没有有效画面流");
  const {
    rotation,
    sar,
    width,
    height,
    assumptions,
    inputMatrix,
    inputPrimaries,
    inputTransfer,
    inputRange,
    sourceBitDepth
  } = describeEditorVideo(stream);
  if (Number(probe.format?.duration) > 86400)
    throw new EditorTaskError("LIMIT_EXCEEDED", "兼容画面最多支持 24 小时视频");
  const sourceOriginSeconds = Number(probe.format?.start_time ?? 0);
  if (!Number.isFinite(sourceOriginSeconds))
    throw new EditorTaskError("INVALID_MEDIA", "源视频起始时间无效");
  const previewScale = Math.min(1, 1920 / width, 1080 / height);
  const encodedWidth = purpose === "preview" ? Math.max(2, Math.round(width * previewScale / 2) * 2) : width;
  const encodedHeight = purpose === "preview" ? Math.max(2, Math.round(height * previewScale / 2) * 2) : height;
  const recipeHash = digest2({
    version: purpose === "preview" ? "editor-sdr-preview-v1" : "editor-sdr-proxy-v2-duration",
    sourceHash,
    ffmpeg: context.ffmpegVersion,
    stream: stream.index,
    width,
    height,
    ...purpose === "preview" ? { encodedWidth, encodedHeight } : {},
    rotation,
    sar,
    inputMatrix,
    inputPrimaries,
    inputTransfer,
    inputRange,
    sourceOriginSeconds
  });
  const cache = await directory(context.cacheDir, ["video", recipeHash]);
  const receipt = await optionalJson(cache, ["receipt.json"]);
  if (receipt?.recipeHash === recipeHash && receipt.sourceHash === sourceHash) {
    const saved = await regular(cache, ["video.mp4"]);
    if (await fileHash(saved, context.signal) === receipt.sha256) {
      context.onProgress?.(1);
      return { ...receipt, path: saved };
    }
    throw new EditorTaskError("CACHE_CHANGED", "已准备视频内容发生变化，请清理该任务缓存后重试");
  }
  let reported = -1;
  const report = (fraction) => {
    if (fraction >= 1 || fraction - reported >= 0.01) {
      reported = fraction;
      context.onProgress?.(fraction);
    }
  };
  const durationSeconds = Number(stream.duration) || Number(probe.format?.duration) || 0, [rateNumerator, rateDenominator] = String(stream.avg_frame_rate || stream.r_frame_rate).split("/").map(Number), expectedFrames = Number(stream.nb_frames) || Math.round(durationSeconds * rateNumerator / (rateDenominator || 1)) || 0;
  const scanned = (start, span) => (count) => {
    if (expectedFrames > 0) report(start + span * Math.min(1, count / expectedFrames));
  };
  const original = await timeline(path, stream.index, sourceOriginSeconds, context, scanned(0, 0.6));
  if (original.firstTick !== 0)
    throw new EditorTaskError(
      "UNSUPPORTED_TIMESTAMPS",
      "当前合成器尚不支持晚于素材起点出现的第一帧，请先整理画面起点"
    );
  const output = join11(context.workDir, `proxy-${randomUUID6()}.mp4`);
  const filter = `scale=${encodedWidth}:${encodedHeight}:flags=${purpose === "preview" ? "bilinear" : "lanczos"},setsar=1,colorspace=ispace=${inputMatrix}:iprimaries=${inputPrimaries}:itrc=${inputTransfer}:irange=${inputRange}:space=bt709:primaries=bt709:trc=bt709:range=tv:format=${purpose === "preview" ? "yuv420p" : "yuv444p"}:dither=fsb`;
  try {
    await runMediaProcess(
      context.ffmpegPath,
      [
        "-nostdin",
        "-v",
        "error",
        ...safety3,
        "-copyts",
        "-start_at_zero",
        "-i",
        path,
        "-map",
        `0:${stream.index}`,
        "-an",
        "-sn",
        "-dn",
        "-vf",
        filter,
        "-fps_mode",
        "passthrough",
        "-enc_time_base",
        "1:240000",
        "-c:v",
        purpose === "preview" ? "libx264" : "libvpx-vp9",
        ...purpose === "preview" ? ["-crf", "23", "-preset", "ultrafast", "-pix_fmt", "yuv420p"] : [
          "-lossless",
          "1",
          "-pix_fmt",
          "yuv444p",
          "-deadline",
          "good",
          "-cpu-used",
          "4",
          "-row-mt",
          "1"
        ],
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-video_track_timescale",
        "240000",
        "-movflags",
        "+faststart",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        output
      ],
      {
        signal: context.signal,
        durationSeconds,
        onStdout: () => {
        },
        onProgress: ({ fraction }) => report(0.6 + 0.25 * (fraction ?? 0))
      }
    );
    report(0.85);
    const actual = await timeline(output, 0, 0, context, scanned(0.85, 0.149));
    if (actual.hash !== original.hash || actual.count !== original.count || actual.endTick !== original.endTick)
      throw new EditorTaskError(
        "PROXY_TIMING_MISMATCH",
        "兼容视频的帧时间与原素材不一致，已停止输出"
      );
    const saved = join11(cache, "video.mp4");
    await rename3(output, saved);
    const result = {
      path: saved,
      mimeType: "video/mp4",
      sha256: await fileHash(saved, context.signal),
      recipeHash,
      sourceHash,
      width,
      height,
      sourceOriginSeconds,
      frameCount: actual.count,
      color: {
        space: "bt709",
        primaries: "bt709",
        transfer: "bt709",
        range: "tv",
        sourceBitDepth,
        assumptions
      }
    };
    const { path: _path, ...publicReceipt } = result;
    await atomic(join11(cache, "receipt.json"), Buffer.from(JSON.stringify(publicReceipt)));
    report(1);
    return result;
  } finally {
    await rm8(output, { force: true });
  }
}

// native/editor-runtime/inspect.ts
import { dirname as dirname5, basename as basename2 } from "node:path";
var inputOptions = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mp3,wav,aiff,flac,ogg,aac,mpeg,mpegts,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,apng,j2k_pipe"
];
function rational(n, d = 1n) {
  if (d === 0n) throw new Error("无效时间基准");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n, b = d;
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return { n: n / (a || 1n), d: d / (a || 1n) };
}
var add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
var sub = (a, b) => add(a, rational(-b.n, b.d));
var compare = (a, b) => a.n * b.d - b.n * a.d;
var publicRational = (v) => ({ numerator: String(v.n), denominator: String(v.d) });
function ratio2(value) {
  if (typeof value !== "string" || !/^[-+]?\d+[/:]\d+$/.test(value)) return;
  const [n, d] = value.split(/[/:]/).map(BigInt);
  if (!d) return;
  return rational(n, d);
}
function decimal(value) {
  if (typeof value !== "string" || !/^[-+]?\d+(?:\.\d+)?$/.test(value)) return;
  const whole2 = value.split(".");
  return rational(BigInt(whole2.join("")), 10n ** BigInt(whole2[1]?.length ?? 0));
}
function whole(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return;
  if (!/^[-+]?\d+$/.test(String(value))) return;
  return BigInt(String(value));
}
var time = (pts, base) => {
  const n = whole(pts);
  return n === void 0 ? void 0 : rational(n * base.n, base.d);
};
var numeric = (r) => Number(r.n) / Number(r.d);
var ticks = (r) => {
  const n = r.n * 240000n;
  return Number(n < 0n ? -((-n + r.d / 2n) / r.d) : (n + r.d / 2n) / r.d);
};
var frameRate = (value) => {
  const r = ratio2(value);
  if (!r || r.n <= 0 || r.d <= 0 || r.n > 1000000000n || r.d > 1000000000n) return null;
  return { numerator: Number(r.n), denominator: Number(r.d) };
};
var field = (value) => typeof value === "string" ? value.slice(0, 128) : "unknown";
async function inspectEditorSource(path, resourceId2, ffprobePath, signal) {
  const bytes = (await stat9(path)).size;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 20 * 1024 ** 3)
    throw new EditorTaskError("INVALID_MEDIA", "素材为空或超过 20GiB 限制");
  const sha2562 = await fileHash(path, signal);
  if (resourceId2.startsWith("asset-") && resourceId2 !== `asset-${sha2562}`)
    throw new EditorTaskError("SOURCE_CHANGED", "素材内容与资源身份不一致");
  const probe = JSON.parse(
    (await runMediaProcess(
      ffprobePath,
      ["-v", "error", ...inputOptions, "-show_streams", "-show_format", "-of", "json", path],
      { signal, maxStdoutBytes: 512 * 1024 }
    )).stdout.toString()
  );
  if (!Array.isArray(probe.streams) || probe.streams.length > 64)
    throw new EditorTaskError("INVALID_MEDIA", "媒体轨道列表无效或超过 64 条限制");
  const video = probe.streams.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic
  ), audio2 = probe.streams.find((s) => s.codec_type === "audio");
  if (!video && !audio2) throw new EditorTaskError("INVALID_MEDIA", "素材没有可解析的画面或声音");
  const magic = await readPrefix(dirname5(path), [basename2(path)]), format = field(probe.format?.format_name);
  const imageMime = magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : magic[0] === 255 && magic[1] === 216 ? "image/jpeg" : magic.subarray(0, 3).toString() === "GIF" ? "image/gif" : magic.subarray(8, 12).toString() === "WEBP" ? "image/webp" : magic.subarray(4, 12).toString().includes("ftypavif") ? "image/avif" : magic.subarray(0, 2).toString() === "BM" ? "image/bmp" : magic.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || magic.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42])) ? "image/tiff" : void 0;
  const kind = imageMime && video ? "image" : video ? "video" : "audio";
  const selected = [video, audio2].filter(Boolean);
  const bases = /* @__PURE__ */ new Map();
  for (const stream of selected) {
    const base = ratio2(stream.time_base);
    if (!base || base.n <= 0n)
      throw new EditorTaskError("INVALID_MEDIA", "媒体缺少有效的有理时间基准");
    bases.set(stream.index, base);
  }
  const starts = selected.map((s) => time(s.start_pts, bases.get(s.index))).filter((v) => Boolean(v));
  let origin = starts.length ? starts.reduce((a, b) => compare(a, b) < 0 ? a : b) : decimal(probe.format?.start_time) ?? rational(0n);
  if (kind === "image") origin = rational(0n);
  const streams = /* @__PURE__ */ new Map();
  for (const s of selected)
    streams.set(s.index, { count: 0, variable: false, invalid: false, samples: 0n });
  let pending = "";
  const consume = (chunk) => {
    const lines = (pending + chunk.toString()).split(/\r?\n/);
    pending = lines.pop();
    if (pending.length > 8192) throw new EditorTaskError("INVALID_MEDIA", "媒体帧记录超出限制");
    for (const line of lines) {
      const f = Object.fromEntries(line.split("|").map((part2) => part2.split("=")));
      const index = Number(f.stream_index), state = streams.get(index), base = bases.get(index);
      if (!state || !base) continue;
      state.count++;
      if (state.count > 1e7)
        throw new EditorTaskError("LIMIT_EXCEEDED", "素材解码帧数超过当前分析限制");
      const pts = time(f.best_effort_timestamp ?? f.pts, base);
      if (!pts) {
        state.invalid = true;
        continue;
      }
      let duration2;
      if (audio2?.index === index) {
        const samples = whole(f.nb_samples);
        if (samples === void 0 || samples <= 0n || !Number.isSafeInteger(Number(audio2.sample_rate)) || Number(audio2.sample_rate) < 1) {
          state.invalid = true;
          continue;
        }
        state.samples += samples;
        duration2 = rational(samples, BigInt(audio2.sample_rate));
      } else duration2 = time(f.duration ?? f.pkt_duration, base);
      if (!duration2 || duration2.n <= 0n) {
        state.invalid = true;
        continue;
      }
      if (!state.first) state.first = pts;
      if (state.last) {
        const step = sub(pts, state.last);
        if (step.n <= 0n) state.invalid = true;
        else if (state.step && compare(step, state.step) !== 0n) state.variable = true;
        state.step = step;
      }
      state.last = pts;
      const end = add(pts, duration2);
      if (!state.end || compare(end, state.end) > 0n) state.end = end;
    }
  };
  await runMediaProcess(
    ffprobePath,
    [
      "-v",
      "error",
      ...inputOptions,
      ...kind === "image" ? ["-read_intervals", "%+#1"] : [],
      "-show_frames",
      "-show_entries",
      "frame=stream_index,pts,best_effort_timestamp,duration,pkt_duration,nb_samples",
      "-of",
      "compact=p=0:nk=0",
      path
    ],
    { signal, onStdout: consume }
  );
  consume(Buffer.from("\n"));
  if (video && !streams.get(video.index)?.count || audio2 && !streams.get(audio2.index)?.count)
    throw new EditorTaskError("INVALID_MEDIA", "素材没有能够实际解码的画面或声音");
  const limitations = [];
  let duration = rational(0n), trimmedAudioPadding = rational(0n);
  for (const stream of selected) {
    const state = streams.get(stream.index);
    if (kind === "image") continue;
    let end = state.end;
    if (state.invalid || !end) {
      const declared2 = time(stream.duration_ts, bases.get(stream.index));
      if (!declared2) throw new EditorTaskError("INVALID_MEDIA", "素材缺少准确时长，无法加入工程");
      end = add(time(stream.start_pts, bases.get(stream.index)) ?? origin, declared2);
      limitations.push({
        code: "UNSUPPORTED_TIMESTAMPS",
        message: "素材包含无法准确定位的帧时间，需先修复时间戳后预览或导出"
      });
    }
    const declared = time(stream.duration_ts, bases.get(stream.index));
    if (stream === audio2 && declared && declared.n > 0n) {
      const declaredEnd = add(time(stream.start_pts, bases.get(stream.index)) ?? origin, declared);
      if (compare(declaredEnd, end) < 0n) {
        trimmedAudioPadding = sub(end, declaredEnd);
        end = declaredEnd;
      }
    }
    const span = sub(end, origin);
    if (compare(span, duration) > 0n) duration = span;
  }
  const durationTick = kind === "image" ? 0 : ticks(duration);
  if (!Number.isSafeInteger(durationTick) || kind !== "image" && durationTick < 1 || durationTick > MAX_EDITOR_TICK)
    throw new EditorTaskError("LIMIT_EXCEEDED", "素材时长无效或超过当前 24 小时限制");
  let width, height;
  let videoInfo;
  if (video) {
    const sar = ratio2(video.sample_aspect_ratio) ?? rational(1n), rotation = Number(
      video.side_data_list?.find((s) => Number.isFinite(s.rotation))?.rotation ?? video.tags?.rotate ?? 0
    );
    if (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) || video.width < 1 || video.height < 1)
      throw new EditorTaskError("INVALID_MEDIA", "素材画面尺寸无效");
    const displayWidth = Math.round(video.width * numeric(sar)), rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
    width = rotated ? video.height : displayWidth;
    height = rotated ? displayWidth : video.height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192)
      throw new EditorTaskError("LIMIT_EXCEEDED", "素材显示尺寸超过当前 8192 像素限制");
    const state = streams.get(video.index);
    videoInfo = {
      streamIndex: video.index,
      codec: field(video.codec_name),
      pixelFormat: field(video.pix_fmt),
      codedWidth: video.width,
      codedHeight: video.height,
      displayWidth: width,
      displayHeight: height,
      sampleAspectRatio: publicRational(sar),
      rotation,
      frameRate: frameRate(video.r_frame_rate),
      averageFrameRate: frameRate(video.avg_frame_rate),
      timeBase: publicRational(bases.get(video.index)),
      frameCount: state.count,
      variableFrameRate: state.variable,
      firstFrame: state.first ? publicRational(sub(state.first, origin)) : null,
      color: {
        space: field(video.color_space),
        primaries: field(video.color_primaries),
        transfer: field(video.color_transfer),
        range: field(video.color_range),
        sourceBitDepth: Number(video.bits_per_raw_sample) || Number(/p(\d+)(?:le|be)$/.exec(String(video.pix_fmt))?.[1]) || 8
      }
    };
    if (kind === "video") {
      try {
        const policy = describeEditorVideo(video);
        videoInfo.conversionAssumptions = policy.assumptions;
      } catch (error) {
        if (!(error instanceof EditorTaskError)) throw error;
        limitations.push({ code: error.code, message: error.message });
      }
      if (state.first && ticks(sub(state.first, origin)) !== 0)
        limitations.push({
          code: "UNSUPPORTED_TIMESTAMPS",
          message: "第一帧晚于素材起点，当前合成器需要先整理画面起点"
        });
    } else if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(imageMime))
      limitations.push({
        code: "UNSUPPORTED_IMAGE",
        message: "图片已入库；当前合成器需要先转换为 PNG 或 JPEG"
      });
  }
  const audioInfo = audio2 ? {
    streamIndex: audio2.index,
    codec: field(audio2.codec_name),
    sampleRate: Number(audio2.sample_rate) || 0,
    channels: Number(audio2.channels) || 0,
    timeBase: publicRational(bases.get(audio2.index)),
    decodedSamples: String(streams.get(audio2.index).samples),
    trimmedEncoderPadding: publicRational(trimmedAudioPadding)
  } : void 0;
  const mimeType = imageMime ?? (kind === "video" ? format.includes("matroska") ? "video/x-matroska" : format.includes("avi") ? "video/x-msvideo" : format.includes("mpegts") ? "video/mp2t" : format === "mpeg" ? "video/mpeg" : String(probe.format?.tags?.major_brand).trim() === "qt" ? "video/quicktime" : "video/mp4" : format.includes("mp3") ? "audio/mpeg" : format.includes("wav") ? "audio/wav" : format.includes("aiff") ? "audio/aiff" : format.includes("flac") ? "audio/flac" : format.includes("ogg") ? "audio/ogg" : format.includes("aac") ? "audio/aac" : "audio/mp4");
  return {
    resourceId: resourceId2,
    sha256: sha2562,
    bytes,
    kind,
    duration: durationTick,
    ...width === void 0 ? {} : { width, height },
    mimeType,
    inspection: {
      schemaVersion: 1,
      format,
      timing: {
        origin: publicRational(origin),
        duration: publicRational(duration),
        tickRounding: "nearest",
        basis: kind === "image" ? "static-image" : trimmedAudioPadding.n ? "decoded-frames-and-stream-duration" : "decoded-frames"
      },
      ...videoInfo ? { video: videoInfo } : {},
      ...audioInfo ? { audio: audioInfo } : {},
      compatibility: {
        preview: limitations.length ? "unsupported" : kind === "video" ? "native-proxy" : kind === "audio" ? "prepared-audio" : "static-image",
        export: limitations.length ? "unsupported" : "supported",
        limitations
      }
    }
  };
}

// native/editor-runtime/runtime.ts
var artifactValue = (artifact) => ({
  id: artifact.assetId,
  name: artifact.name,
  mimeType: artifact.mimeType,
  bytes: artifact.bytes,
  sha256: artifact.sha256
});
async function runEditorRequest(raw, context) {
  const request = validateEditorRequest(raw);
  abort(context.signal);
  const [ffmpegPath, ffprobePath] = await Promise.all(
    ["ffmpeg", "ffprobe"].map(
      async (name) => context.tools?.[`${name}Path`] ?? await findExecutable(name, void 0, context.toolSearchDirectories)
    )
  );
  context = {
    ...context,
    tools: {
      ...context.tools,
      ...ffmpegPath ? { ffmpegPath } : {},
      ...ffprobePath ? { ffprobePath } : {}
    }
  };
  hash(context.scopeKey);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(context.jobId))
    throw new EditorTaskError("INVALID_REQUEST", "主程序任务编号无效");
  const root = await sealed(context.jobDir), runtime = await sealed(context.runtimeDir);
  if (request.action === "inspect-source") {
    const id3 = request.resourceIds[0], input = await regular(root, ["inputs", "resource-0.bin"]);
    await context.reportProgress({ fraction: 0, stage: "inspect-source" });
    const result = await inspectEditorSource(
      input,
      id3,
      context.tools?.ffprobePath ?? "ffprobe",
      context.signal
    );
    if (await fileHash(input, context.signal) !== result.sha256)
      throw new EditorTaskError("SOURCE_CHANGED", "素材在分析过程中发生变化，请重新导入");
    await context.reportProgress({ fraction: 1, stage: "complete" });
    return { result, artifacts: [] };
  }
  const scope = await directory(runtime, ["scopes", context.scopeKey]);
  const transfer = await directory(scope, ["transfers", request.transferId]);
  const work = await directory(root, [`work-${randomUUID7()}`]);
  const resources = await directory(transfer, ["resources"]);
  const cache = await directory(scope, ["cache"]);
  const artifacts = [];
  let succeeded = false;
  const progress2 = async (fraction, stage, message) => {
    abort(context.signal);
    await context.reportProgress({ fraction, stage, ...message ? { message } : {} });
  };
  const add2 = async (path, extension, mimeType, role) => {
    const artifact = await publish(root, path, extension, mimeType, role, context.signal);
    if (!artifacts.some((item) => item.assetId === artifact.assetId)) artifacts.push(artifact);
    if (artifacts.length > 128)
      throw new EditorTaskError("LIMIT_EXCEEDED", "本批输出超过 128 个资源，请继续分批准备");
    return artifactValue(artifact);
  };
  const report = async (value) => {
    const path = join12(work, `report-${randomUUID7()}.json`);
    await atomic(path, Buffer.from(JSON.stringify(value)));
    return add2(path, "json", "application/json", "editor-report");
  };
  const material = async (binding) => {
    const id3 = resourceId(binding.resourceId), path = await regular(resources, [`${id3}.bin`]);
    if (await fileHash(path, context.signal) !== hash(binding.sha256) || (await stat10(path)).size !== binding.bytes)
      throw new EditorTaskError("SOURCE_CHANGED", "已准备素材内容发生变化，请重新建立快照");
    return path;
  };
  const link4 = async (source2, target) => {
    const temporary = join12(dirname6(target), `${basename3(target)}.${randomUUID7()}.tmp`);
    try {
      await hardLink(source2, temporary).catch(() => copyFile3(source2, temporary));
      await rename4(temporary, target);
    } finally {
      await rm9(temporary, { force: true });
    }
  };
  const remember = async (binding, path) => {
    const library = await directory(scope, ["resources"]), id3 = resourceId(binding.resourceId);
    try {
      await link4(path, join12(library, `${id3}.bin`));
      await atomic(join12(library, `${id3}.json`), Buffer.from(JSON.stringify(binding)));
    } catch (error) {
      if (context.signal.aborted) throw error;
    }
  };
  const reuse = async (id3) => {
    const library = await directory(scope, ["resources"]);
    try {
      const binding = await optionalJson(library, [`${id3}.json`]);
      if (!binding) return void 0;
      const path = await regular(library, [`${id3}.bin`]);
      if (binding.resourceId !== id3 || id3.startsWith("asset-") && id3 !== `asset-${binding.sha256}` || (await stat10(path)).size !== binding.bytes || await fileHash(path, context.signal) !== hash(binding.sha256))
        throw new EditorTaskError("SOURCE_CHANGED", "已保存的原始素材校验失败");
      await link4(path, join12(resources, `${id3}.bin`));
      await atomic(join12(resources, `${id3}.json`), Buffer.from(JSON.stringify(binding)));
      return binding;
    } catch (error) {
      if (context.signal.aborted) throw error;
      for (const name of [`${id3}.json`, `${id3}.bin`])
        await rm9(join12(library, name), { force: true });
      return void 0;
    }
  };
  const builtin = async () => {
    const id3 = `asset-${EDITOR_DEMO_NARRATION_SHA}`;
    let binding = await optionalJson(resources, [`${id3}.json`]);
    if (!binding) {
      if (!context.builtinNarrationPath || await fileHash(context.builtinNarrationPath, context.signal) !== EDITOR_DEMO_NARRATION_SHA)
        throw new EditorTaskError(
          "BUILTIN_CHANGED",
          "安装包中的示例旁白缺失或校验失败，请重新安装视频面板"
        );
      const bytes = (await stat10(context.builtinNarrationPath)).size;
      const temporary = join12(resources, `${id3}.${randomUUID7()}.tmp`);
      try {
        await copyFile3(context.builtinNarrationPath, temporary);
        if (await fileHash(temporary, context.signal) !== EDITOR_DEMO_NARRATION_SHA)
          throw new EditorTaskError("BUILTIN_CHANGED", "示例旁白内容变化");
        await rename4(temporary, join12(resources, `${id3}.bin`));
        binding = { resourceId: id3, sha256: EDITOR_DEMO_NARRATION_SHA, bytes };
        await atomic(join12(resources, `${id3}.json`), Buffer.from(JSON.stringify(binding)));
      } finally {
        await rm9(temporary, { force: true });
      }
    }
    if (binding.sha256 !== EDITOR_DEMO_NARRATION_SHA || binding.resourceId !== id3)
      throw new EditorTaskError("BUILTIN_CHANGED", "示例旁白回执无效");
    return { binding, path: await material(binding) };
  };
  try {
    if (request.action === "align-multicam") {
      const settings = request.alignment, sources = [];
      for (const [index, resourceId2] of request.resourceIds.entries()) {
        const path = await regular(root, ["inputs", `resource-${index}.bin`]), sha = await fileHash(path, context.signal);
        if (resourceId2.startsWith("asset-") && resourceId2 !== `asset-${sha}` || settings.sourceHashes?.[index] && settings.sourceHashes[index] !== sha)
          throw new EditorTaskError("SOURCE_CHANGED", "机位素材内容与资源编号或工程指纹不匹配");
        sources.push({ resourceId: resourceId2, path, duration: settings.sourceDurations[index] });
      }
      await progress2(0, "align-multicam");
      const result = await alignEditorMulticam({
        sources,
        referenceResourceId: settings.referenceResourceId,
        windowSeconds: settings.windowSeconds,
        maxOffsetSeconds: settings.maxOffsetSeconds,
        cacheDir: await directory(cache, ["multicam"]),
        pcmCacheDir: await directory(cache, ["pcm"]),
        ffmpegPath: context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath: context.tools?.ffprobePath ?? "ffprobe",
        signal: context.signal
      });
      await progress2(1, "complete");
      succeeded = true;
      return {
        result: { ...result, ...settings.origin ? { origin: settings.origin } : {} },
        artifacts
      };
    }
    if (request.action === "prepare-source-video") {
      const id3 = request.resourceIds[0], input = await regular(root, ["inputs", "resource-0.bin"]), sourceHash = await fileHash(input, context.signal);
      if (id3.startsWith("asset-") && id3 !== `asset-${sourceHash}`)
        throw new EditorTaskError("SOURCE_CHANGED", "素材内容与资源编号不匹配");
      await progress2(0, "prepare-source-video");
      const ffmpegPath3 = context.tools?.ffmpegPath ?? "ffmpeg", ffprobePath3 = context.tools?.ffprobePath ?? "ffprobe";
      const ffmpegVersion2 = (await runMediaProcess(ffmpegPath3, ["-hide_banner", "-version"], { signal: context.signal })).stdout.toString();
      const proxy = await prepareEditorProxy(input, sourceHash, {
        ffmpegPath: ffmpegPath3,
        ffprobePath: ffprobePath3,
        ffmpegVersion: ffmpegVersion2,
        cacheDir: cache,
        workDir: work,
        signal: context.signal
      });
      if (await fileHash(input, context.signal) !== sourceHash)
        throw new EditorTaskError("SOURCE_CHANGED", "素材在兼容画面准备时发生变化");
      const artifact = await add2(proxy.path, "mp4", "video/mp4", "editor-video-source"), { path: _path, ...recipe } = proxy;
      await progress2(1, "complete");
      succeeded = true;
      return { result: { resourceId: id3, sourceHash, proxy: artifact, recipe }, artifacts };
    }
    if (request.action === "analyze-waveform") {
      const id3 = request.resourceIds[0], input = await regular(root, ["inputs", "resource-0.bin"]);
      await progress2(0, "analyze-waveform");
      const analysis = await analyzeEditorWaveform({
        input,
        sourceDuration: request.sourceDuration,
        cacheDir: await directory(cache, ["waveforms"]),
        pcmCacheDir: await directory(cache, ["pcm"]),
        ffmpegPath: context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath: context.tools?.ffprobePath ?? "ffprobe",
        signal: context.signal
      });
      if (id3.startsWith("asset-") && id3 !== `asset-${analysis.sourceHash}`)
        throw new EditorTaskError("SOURCE_CHANGED", "素材内容与资源编号不匹配");
      const waveform = await add2(analysis.path, "json", "application/json", "editor-waveform");
      await progress2(1, "complete");
      succeeded = true;
      return {
        result: {
          resourceId: id3,
          sourceHash: analysis.sourceHash,
          recipeHash: analysis.recipeHash,
          waveform,
          reused: analysis.reused,
          reusedPcm: analysis.reusedPcm
        },
        artifacts
      };
    }
    if ([
      "import-project",
      "project-import-status",
      "publish-project-media",
      "discard-project-import"
    ].includes(request.action)) {
      const result = await runPortableImportRequest(request, {
        root,
        transfer,
        signal: context.signal,
        add: add2,
        progress: progress2
      }).catch(portableTaskError);
      succeeded = true;
      return { result, artifacts };
    }
    const discarded = await optionalJson(transfer, ["discarded.json"]);
    if (discarded && request.action !== "discard")
      throw new EditorTaskError("TRANSFER_DISCARDED", "此快照已释放，请创建新的准备任务");
    if (request.action === "stage-status") {
      const present = [];
      for (const id3 of request.resourceIds) {
        const binding = await optionalJson(resources, [`${id3}.json`]);
        if (binding) await material(binding);
        if (binding || await reuse(id3)) present.push(id3);
      }
      const chunks = [], documentDir = await directory(transfer, ["documents", request.documentHash]);
      for (const name of await readdir2(documentDir))
        if (/^chunk-\d+\.json$/.test(name)) {
          const receipt = await json(documentDir, [name]);
          const index = Number(/^chunk-(\d+)\.json$/.exec(name)[1]);
          if (index >= EDITOR_TASK_LIMITS.documentBytes / EDITOR_TASK_LIMITS.chunkBytes) continue;
          const bytes = await readBytes(
            documentDir,
            [`chunk-${index}.bin`],
            EDITOR_TASK_LIMITS.chunkBytes
          );
          if (receipt.sha256 === bytesHash(bytes)) chunks.push(index);
        }
      const manifest2 = await optionalJson(
        transfer,
        ["manifest.json"],
        EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024
      );
      succeeded = true;
      return {
        result: {
          resourceIds: present,
          chunks: chunks.sort((a, b) => a - b),
          ...manifest2 ? {
            committedDocumentHash: manifest2.documentHash,
            sequenceId: manifest2.sequenceId,
            ...manifest2.kind ? { kind: manifest2.kind } : {}
          } : {}
        },
        artifacts
      };
    }
    if (request.action === "stage-resources") {
      const staged = [];
      for (let index = 0; index < request.resourceIds.length; index++) {
        const id3 = request.resourceIds[index];
        const path = await regular(root, ["inputs", `resource-${index}.bin`]);
        const bytes = (await stat10(path)).size;
        if (bytes < 1 || bytes > 20 * 1024 ** 3)
          throw new EditorTaskError("LIMIT_EXCEEDED", "素材超过当前 20GiB 资源大小限制");
        const sha2562 = await fileHash(path, context.signal);
        if (id3.startsWith("asset-") && id3 !== `asset-${sha2562}`)
          throw new EditorTaskError("SOURCE_CHANGED", "主程序素材内容校验失败");
        const binding = { resourceId: id3, sha256: sha2562, bytes };
        const previous = await optionalJson(resources, [`${id3}.json`]);
        if (previous && (previous.sha256 !== sha2562 || previous.bytes !== bytes))
          throw new EditorTaskError("SOURCE_CHANGED", "同一快照中的原文件已变化，请创建新快照");
        if (previous) await material(previous);
        else {
          const temporary = join12(resources, `${id3}.${randomUUID7()}.tmp`);
          try {
            await copyFile3(path, temporary);
            abort(context.signal);
            if (await fileHash(temporary, context.signal) !== sha2562)
              throw new EditorTaskError("SOURCE_CHANGED", "素材在准备时发生变化");
            await rename4(temporary, join12(resources, `${id3}.bin`));
            await atomic(join12(resources, `${id3}.json`), Buffer.from(JSON.stringify(binding)));
          } finally {
            await rm9(temporary, { force: true });
          }
        }
        await remember(binding, join12(resources, `${id3}.bin`));
        staged.push(binding);
        await progress2((index + 1) / request.resourceIds.length, "stage-resources");
      }
      succeeded = true;
      return { result: { resources: staged }, artifacts };
    }
    if (request.action === "stage-document") {
      const bytes = Buffer.from(request.dataBase64, "base64");
      if (!bytes.length || bytes.length > EDITOR_TASK_LIMITS.chunkBytes || bytes.toString("base64") !== request.dataBase64)
        throw new EditorTaskError("INVALID_REQUEST", "工程数据块编码无效");
      const committed = await optionalJson(
        transfer,
        ["manifest.json"],
        EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024
      );
      if (committed && committed.documentHash !== request.documentHash)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "快照已提交，请为新修改建立新的快照");
      const doc = await directory(transfer, ["documents", request.documentHash]);
      const metadata = await optionalJson(doc, ["chunks.json"]);
      if (metadata && metadata.count !== request.chunkCount)
        throw new EditorTaskError("INVALID_REQUEST", "工程数据块总数不一致");
      await atomic(
        join12(doc, "chunks.json"),
        Buffer.from(JSON.stringify({ count: request.chunkCount }))
      );
      await atomic(join12(doc, `chunk-${request.chunkIndex}.bin`), bytes);
      await atomic(
        join12(doc, `chunk-${request.chunkIndex}.json`),
        Buffer.from(JSON.stringify({ sha256: bytesHash(bytes) }))
      );
      succeeded = true;
      return { result: { chunkIndex: request.chunkIndex, bytes: bytes.length }, artifacts };
    }
    if (request.action === "commit" || request.action === "commit-project") {
      const project = request.action === "commit-project";
      const previous = await optionalJson(
        transfer,
        ["manifest.json"],
        EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024
      );
      if (previous && (previous.documentHash !== request.documentHash || previous.sequenceId !== request.sequenceId || previous.kind === "project" !== project))
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "快照已提交，请为新修改建立新的快照");
      const doc = await directory(transfer, ["documents", request.documentHash]);
      const metadata = await json(doc, ["chunks.json"]);
      if (metadata.count !== request.chunkCount)
        throw new EditorTaskError("INCOMPLETE_STAGE", "工程数据块尚未完整准备");
      const chunks = [];
      let total = 0;
      for (let index = 0; index < request.chunkCount; index++) {
        const bytes2 = await readBytes(doc, [`chunk-${index}.bin`], EDITOR_TASK_LIMITS.chunkBytes);
        total += bytes2.length;
        if (total > EDITOR_TASK_LIMITS.documentBytes || index < request.chunkCount - 1 && bytes2.length !== EDITOR_TASK_LIMITS.chunkBytes)
          throw new EditorTaskError("INCOMPLETE_STAGE", "工程数据块长度不一致");
        chunks.push(bytes2);
      }
      const bytes = Buffer.concat(chunks);
      if (total !== request.byteLength || bytesHash(bytes) !== request.documentHash)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "工程内容校验失败，请重新分批准备");
      const rawDocument = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
      const selected2 = project ? editorProjectDocument(rawDocument) : editorTaskDocument(rawDocument, request.sequenceId);
      if (project && selected2.document.activeSequenceId !== request.sequenceId)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "完整工程的当前序列不一致");
      if (bytesHash(Buffer.from(JSON.stringify(selected2.document))) !== request.documentHash)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "工程快照不是规范化的依赖闭包");
      const bindings = [];
      for (const id3 of selected2.resourceIds) {
        const binding = await json(resources, [`${id3}.json`]);
        await material(binding);
        bindings.push(binding);
      }
      if (selected2.document.assets.some(isEditorDemoNarration)) await builtin();
      const manifest2 = {
        ...project ? { kind: "project" } : {},
        documentHash: request.documentHash,
        sequenceId: request.sequenceId,
        document: selected2.document,
        bindings
      };
      await atomic(join12(transfer, "manifest.json"), Buffer.from(JSON.stringify(manifest2)));
      succeeded = true;
      return {
        result: {
          documentHash: manifest2.documentHash,
          sequenceId: manifest2.sequenceId,
          documentId: manifest2.document.id,
          revision: manifest2.document.revision,
          resourceCount: bindings.length,
          ...project ? { kind: "project" } : {}
        },
        artifacts
      };
    }
    if (request.action === "discard") {
      await atomic(join12(transfer, "discarded.json"), Buffer.from("{}"));
      for (const name of ["resources", "documents"])
        await rm9(join12(transfer, name), { recursive: true, force: true });
      await rm9(join12(transfer, "manifest.json"), { force: true });
      succeeded = true;
      return { result: { discarded: true, transferId: request.transferId }, artifacts };
    }
    const manifest = await json(
      transfer,
      ["manifest.json"],
      EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024
    );
    record(manifest, ["kind", "documentHash", "sequenceId", "document", "bindings"], "工程快照");
    if (manifest.kind !== void 0 && manifest.kind !== "project")
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "工程快照类型无效");
    if (manifest.kind === "project" !== (request.action === "export-project"))
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "完整工程包需要独立的完整工程快照");
    if (manifest.documentHash !== request.documentHash || manifest.sequenceId !== request.sequenceId)
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "请求与已提交工程快照不一致");
    const selected = manifest.kind === "project" ? editorProjectDocument(manifest.document) : editorTaskDocument(manifest.document, manifest.sequenceId);
    if (bytesHash(Buffer.from(JSON.stringify(selected.document))) !== request.documentHash)
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "保存的工程快照内容已变化");
    if (!Array.isArray(manifest.bindings) || manifest.bindings.length !== selected.resourceIds.length)
      throw new EditorTaskError("INCOMPLETE_STAGE", "工程素材绑定不完整");
    const byResource = /* @__PURE__ */ new Map();
    for (const binding of manifest.bindings) {
      if (!selected.resourceIds.includes(binding.resourceId) || byResource.has(binding.resourceId))
        throw new EditorTaskError("INCOMPLETE_STAGE", "工程素材绑定存在无效项");
      byResource.set(binding.resourceId, { binding, path: await material(binding) });
    }
    const installedNarration = selected.document.assets.some(isEditorDemoNarration) ? await builtin() : void 0;
    const original = (assetId) => {
      const asset2 = selected.document.assets.find((item) => item.id === assetId), value = asset2 && byResource.get(asset2.resourceId ?? asset2.id);
      if (asset2 && isEditorDemoNarration(asset2) && installedNarration) return installedNarration;
      if (!value) throw new EditorTaskError("INCOMPLETE_STAGE", "当前工程缺少已授权的素材");
      return value;
    };
    if (request.action === "analyze-asset-waveform") {
      const assetId = request.assetIds[0], asset2 = selected.document.assets.find((item) => item.id === assetId);
      if (!asset2 || !["video", "audio"].includes(asset2.kind))
        throw new EditorTaskError("INVALID_REQUEST", "请从当前序列选择一个声音或视频素材");
      const annotation = selected.document.production?.waveformAnalysisOrigin;
      let origin;
      if (annotation !== void 0) {
        const value = record(
          annotation,
          ["documentId", "revision", "sequenceId", "assetId", "documentHash"],
          "波形分析来源"
        );
        if (!["documentId", "sequenceId", "assetId"].every(
          (key) => typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 128
        ) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.assetId !== assetId || !isEditorDemoNarration(asset2) || selected.document.assets.length !== 1 || selected.document.sequences.length !== 1 || selected.document.id === value.documentId)
          throw new EditorTaskError("SNAPSHOT_MISMATCH", "波形分析来源与只读分析快照不一致");
        origin = {
          documentId: value.documentId,
          revision: value.revision,
          sequenceId: value.sequenceId,
          assetId: value.assetId,
          documentHash: hash(value.documentHash)
        };
        if (selected.document.id !== `waveform-analysis-${digest2(origin)}`)
          throw new EditorTaskError("SNAPSHOT_MISMATCH", "波形分析快照编号与来源不匹配");
      } else
        origin = {
          documentId: selected.document.id,
          revision: selected.document.revision,
          sequenceId: selected.document.activeSequenceId,
          assetId,
          documentHash: request.documentHash
        };
      const input = original(assetId);
      await progress2(0, "analyze-waveform");
      const analysis = await analyzeEditorWaveform({
        input: input.path,
        sourceDuration: asset2.duration,
        cacheDir: await directory(cache, ["waveforms"]),
        pcmCacheDir: await directory(cache, ["pcm"]),
        ffmpegPath: context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath: context.tools?.ffprobePath ?? "ffprobe",
        signal: context.signal
      });
      if (analysis.sourceHash !== input.binding.sha256)
        throw new EditorTaskError("SOURCE_CHANGED", "工程声音素材内容发生变化");
      const waveform = await add2(analysis.path, "json", "application/json", "editor-waveform");
      await progress2(1, "complete");
      succeeded = true;
      return {
        result: {
          documentHash: request.documentHash,
          sequenceId: request.sequenceId,
          assetId,
          origin,
          resourceId: input.binding.resourceId,
          sourceHash: analysis.sourceHash,
          recipeHash: analysis.recipeHash,
          waveform,
          reused: analysis.reused,
          reusedPcm: analysis.reusedPcm
        },
        artifacts
      };
    }
    if (request.action === "export-project") {
      let progressFailure;
      const packed = await exportPortableProject({
        document: selected.document,
        workDir: work,
        sourceRoots: [resources],
        outputPath: join12(work, "project.mimiproject"),
        signal: context.signal,
        resolveAsset: async (asset2) => {
          const source2 = original(asset2.id);
          return { path: source2.path, bytes: source2.binding.bytes, sha256: source2.binding.sha256 };
        },
        onProgress: (item) => {
          void progress2(
            (item.phase === "checking" ? 0 : 0.45) + (item.total ? item.completed / item.total : 1) * 0.45,
            `bundle-${item.phase}`
          ).catch((error) => {
            progressFailure ??= error;
          });
        }
      }).catch(portableTaskError);
      if (progressFailure) throw progressFailure;
      const bundle = await add2(packed.path, "mimiproject", "application/zip", "portable-project");
      if (bundle.sha256 !== packed.sha256)
        throw new EditorTaskError("SOURCE_CHANGED", "工程包发布校验失败");
      await progress2(1, "complete");
      succeeded = true;
      return {
        result: {
          documentHash: manifest.documentHash,
          bundle,
          mediaCount: packed.manifest.media.length,
          formatVersion: 1
        },
        artifacts
      };
    }
    const ffmpegPath2 = context.tools?.ffmpegPath ?? "ffmpeg", ffprobePath2 = context.tools?.ffprobePath ?? "ffprobe";
    const ffmpegVersion = (await runMediaProcess(ffmpegPath2, ["-hide_banner", "-version"], { signal: context.signal })).stdout.toString();
    const proxyContext = {
      ffmpegPath: ffmpegPath2,
      ffprobePath: ffprobePath2,
      ffmpegVersion,
      cacheDir: cache,
      workDir: work,
      signal: context.signal
    };
    const videos = /* @__PURE__ */ new Map();
    const video = async (assetId, requireGeometry, purpose = "export", onProgress) => {
      const asset2 = selected.document.assets.find((item) => item.id === assetId);
      if (asset2?.kind !== "video")
        throw new EditorTaskError("INVALID_REQUEST", "请仅选择视频素材准备兼容画面");
      const input = original(assetId), proxy = await prepareEditorProxy(
        input.path,
        input.binding.sha256,
        { ...proxyContext, onProgress },
        purpose
      );
      if (requireGeometry && (asset2.width !== proxy.width || asset2.height !== proxy.height))
        throw new EditorTaskError(
          "SOURCE_GEOMETRY_MISMATCH",
          `素材「${asset2.name}」的显示尺寸与旋转或像素比例不一致，请先更新素材显示尺寸`
        );
      videos.set(assetId, proxy);
      return proxy;
    };
    if (request.action === "prepare-video") {
      const sources = [], count = request.assetIds.length;
      for (let index = 0; index < count; index++) {
        const assetId = request.assetIds[index], proxy = await video(assetId, false, "preview", (fraction) => {
          progress2((index + fraction) / count, "prepare-video").catch(() => {
          });
        }), { path: _path, ...recipe } = proxy;
        const asset2 = await add2(proxy.path, "mp4", "video/mp4", "editor-video-source");
        sources.push({ assetId, proxy: asset2, recipe });
        await progress2((index + 1) / count, "prepare-video");
      }
      succeeded = true;
      return {
        result: { documentHash: request.documentHash, sequenceId: request.sequenceId, sources },
        artifacts
      };
    }
    const recipeHash = digest2({
      recipe: "editor-audio-v2-timestamps",
      builtinNarration: installedNarration?.binding,
      documentHash: manifest.documentHash,
      sequenceId: manifest.sequenceId,
      bindings: manifest.bindings,
      ffmpegVersion
    });
    const mixes = await directory(cache, ["mixes", recipeHash]);
    let mix = await optionalJson(mixes, ["receipt.json"]);
    const expected = request.preparedAudio;
    if (expected && (expected.recipeHash !== recipeHash || expected.documentHash !== manifest.documentHash || expected.sequenceId !== manifest.sequenceId))
      throw new EditorTaskError("MIX_MISMATCH", "声音处理配方或源素材已变化，请重新准备声音");
    if (expected && !mix)
      throw new EditorTaskError("MIX_UNAVAILABLE", "已准备声音缓存已释放，请重新准备声音");
    let reused = Boolean(mix);
    if (mix) {
      if (mix.recipeHash !== recipeHash || mix.documentHash !== manifest.documentHash || mix.sequenceId !== manifest.sequenceId || expected && expected.assetId !== mix.assetId)
        throw new EditorTaskError("MIX_MISMATCH", "已准备声音回执不匹配");
      const audioPath = await regular(mixes, ["audio.wav"]);
      if (`asset-${await fileHash(audioPath, context.signal)}` !== mix.assetId || await fileHash(await regular(mixes, ["report.json"]), context.signal) !== mix.reportHash)
        throw new EditorTaskError("CACHE_CHANGED", "已准备声音内容校验失败");
    } else {
      const rendered = await renderEditorAudio({
        document: selected.document,
        sequenceId: manifest.sequenceId,
        resolveAssetPath: async (id3) => original(id3).path,
        ffmpegPath: ffmpegPath2,
        ffprobePath: ffprobePath2,
        workDir: work,
        cacheDir: await directory(cache, ["pcm"]),
        outputPath: join12(work, "mix.wav"),
        signal: context.signal,
        onProgress: (item) => progress2(
          request.action === "render" ? item.fraction * 0.25 : item.fraction * 0.9,
          "prepare-audio"
        )
      });
      const { path: _path, ...details2 } = rendered;
      const reportBytes = Buffer.from(JSON.stringify(details2));
      const assetId = `asset-${await fileHash(rendered.path, context.signal)}`;
      await rename4(rendered.path, join12(mixes, "audio.wav"));
      await atomic(join12(mixes, "report.json"), reportBytes);
      mix = {
        documentHash: manifest.documentHash,
        sequenceId: manifest.sequenceId,
        recipeHash,
        assetId,
        sampleCount: rendered.sampleCount,
        peak: rendered.peak,
        samplesOverFullScale: rendered.samplesOverFullScale,
        reportHash: bytesHash(reportBytes)
      };
      await atomic(join12(mixes, "receipt.json"), Buffer.from(JSON.stringify(mix)));
    }
    const preparedAudio = {
      documentHash: mix.documentHash,
      sequenceId: mix.sequenceId,
      recipeHash: mix.recipeHash,
      assetId: mix.assetId
    };
    const audio2 = await add2(
      await regular(mixes, ["audio.wav"]),
      "wav",
      "audio/wav",
      "editor-preview-audio"
    );
    if (request.action === "prepare-audio") {
      const details2 = await add2(
        await regular(mixes, ["report.json"]),
        "json",
        "application/json",
        "editor-audio-report"
      );
      await progress2(1, "complete");
      succeeded = true;
      return {
        result: {
          preparedAudio,
          audio: audio2,
          report: details2,
          sampleCount: mix.sampleCount,
          peak: mix.peak,
          samplesOverFullScale: mix.samplesOverFullScale,
          reused
        },
        artifacts
      };
    }
    if (bytesHash(Buffer.from(context.runtimeSource)) !== context.runtimeSha)
      throw new EditorTaskError("RUNTIME_CHANGED", "安装的渲染运行代码校验失败");
    const mediaFiles = /* @__PURE__ */ new Map();
    for (let index = 0; index < selected.document.assets.length; index++) {
      const asset2 = selected.document.assets[index];
      if (asset2.kind === "video") {
        const proxy = await video(asset2.id, true);
        mediaFiles.set(asset2.id, { path: proxy.path, mimeType: proxy.mimeType });
      } else if (asset2.kind === "image") {
        const input = original(asset2.id), magic = await readPrefix(resources, [`${input.binding.resourceId}.bin`]);
        const mimeType2 = magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : magic[0] === 255 && magic[1] === 216 ? "image/jpeg" : magic.subarray(0, 3).toString() === "GIF" ? "image/gif" : magic.subarray(8, 12).toString() === "WEBP" ? "image/webp" : magic.subarray(4, 12).toString().includes("ftypavif") ? "image/avif" : void 0;
        if (!mimeType2)
          throw new EditorTaskError(
            "UNSUPPORTED_IMAGE",
            "此图片格式尚不能用于共享浏览器合成，请转换为 PNG 或 JPEG"
          );
        mediaFiles.set(asset2.id, { path: input.path, mimeType: mimeType2 });
      }
      await progress2(
        0.25 + (index + 1) / Math.max(1, selected.document.assets.length) * 0.15,
        "prepare-video"
      );
    }
    const outputPath2 = join12(work, `video.${request.profile.container}`);
    const output = await exportEditorSequence({
      document: selected.document,
      sequenceId: manifest.sequenceId,
      profile: request.profile,
      mediaFiles,
      runtimeSource: context.runtimeSource,
      workDir: work,
      audioFile: await regular(mixes, ["audio.wav"]),
      outputPath: outputPath2,
      ffmpegPath: ffmpegPath2,
      ffprobePath: ffprobePath2,
      signal: context.signal,
      browserPath: context.tools?.browserPath,
      onProgress: (item) => progress2(
        item.phase === "verify" ? 0.98 : 0.4 + item.completedFrames / Math.max(1, item.totalFrames) * 0.55,
        item.phase === "verify" ? "verify-video" : "render-video"
      )
    });
    const mimeType = request.profile.container === "webm" ? "video/webm" : request.profile.container === "mov" ? "video/quicktime" : "video/mp4";
    const exported = await add2(output.path, request.profile.container, mimeType, "editor-video");
    const details = await report({
      documentHash: manifest.documentHash,
      sequenceId: manifest.sequenceId,
      preparedAudio,
      runtimeSha: context.runtimeSha,
      profile: request.profile,
      frameCount: output.frameCount,
      durationSeconds: output.durationSeconds,
      proxies: [...videos].map(([assetId, proxy]) => {
        const { path: _path, ...value } = proxy;
        return { assetId, ...value };
      })
    });
    await progress2(1, "complete");
    succeeded = true;
    return {
      result: {
        video: exported,
        audio: audio2,
        preparedAudio,
        reusedAudio: reused,
        report: details,
        frameCount: output.frameCount,
        durationSeconds: output.durationSeconds,
        verified: true
      },
      artifacts
    };
  } finally {
    await rm9(work, { recursive: true, force: true });
    if (!succeeded) await rm9(join12(root, "outputs"), { recursive: true, force: true });
  }
}

// native/signals.ts
function combineAbortSignals(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort3 = () => {
    for (const signal of signals) signal.removeEventListener("abort", abort3);
    controller.abort();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort3();
      break;
    }
    signal.addEventListener("abort", abort3, { once: true });
  }
  return controller.signal;
}

// native/editor-runtime/cli.ts
async function runEditorCli(runtime) {
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  let outputBytes = 0, lastProgress = 0, lastStage = "";
  const emit = (value) => {
    const line = `${JSON.stringify(value)}
`, bytes = Buffer.byteLength(line);
    if (bytes > 240 * 1024 || outputBytes + bytes > 3.5 * 1024 * 1024)
      throw new EditorTaskError("OUTPUT_LIMIT", "任务回执超过大小限制，请分批处理");
    outputBytes += bytes;
    process.stdout.write(line);
  };
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || (/* @__PURE__ */ new Set([args[0], args[2]])).size !== 2 || [args[0], args[2]].some((flag) => !["--job-dir", "--runtime-dir"].includes(flag)))
      throw new EditorTaskError("INVALID_DIRECTORY", "此入口必须由主程序提供授权任务和运行目录");
    const argument = async (flag) => {
      const path = args[args.indexOf(flag) + 1];
      if (!path || !isAbsolute6(path))
        throw new EditorTaskError("INVALID_DIRECTORY", "授权运行目录无效");
      return sealed(path);
    };
    const jobDir = await argument("--job-dir"), runtimeDir = await argument("--runtime-dir");
    const chunks = [];
    let count = 0;
    for await (const chunk of process.stdin) {
      count += chunk.length;
      if (count > 2 * 1024 * 1024)
        throw new EditorTaskError("INPUT_LIMIT", "任务请求超过 2MiB 限制");
      chunks.push(Buffer.from(chunk));
    }
    const envelope = record(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      [
        "action",
        "transferId",
        "documentHash",
        "sequenceId",
        "resourceIds",
        "assetIds",
        "chunkIndex",
        "chunkCount",
        "byteLength",
        "dataBase64",
        "profile",
        "preparedAudio",
        "sourceDuration",
        "alignment",
        "bundleHash",
        "batchIndex",
        "scopeKey",
        "jobId"
      ],
      "主程序任务"
    );
    const { scopeKey, jobId, ...request } = envelope;
    const signal = combineAbortSignals([
      controller.signal,
      AbortSignal.timeout(2 * 60 * 60 * 1e3)
    ]);
    const response = await runEditorRequest(request, {
      ...runtime,
      builtinNarrationPath: fileURLToPath(new URL("../demo-narration.mp3", import.meta.url)),
      jobDir,
      runtimeDir,
      scopeKey,
      jobId,
      signal,
      reportProgress: (value) => {
        const now = Date.now(), stage = value.stage ?? "";
        if (outputBytes > 3 * 1024 * 1024 || now - lastProgress < 500 && stage === lastStage && value.fraction !== 1)
          return;
        lastProgress = now;
        lastStage = stage;
        emit({ type: "progress", progress: value });
      }
    });
    signal.throwIfAborted();
    emit({ type: "result", result: response });
  } catch (error) {
    const known2 = error instanceof EditorTaskError;
    const cancelled2 = controller.signal.aborted || error instanceof Error && error.name === "AbortError";
    const code = cancelled2 ? "CANCELLED" : known2 ? error.code : error?.code === "ENOENT" ? "MISSING_DEPENDENCY_OR_INPUT" : "EDITOR_TASK_FAILED";
    const candidate = error instanceof Error ? error.message : "";
    const message = cancelled2 ? "编辑器任务已取消" : known2 ? error.message : candidate.length < 350 && candidate && !/(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|[A-Z]:\\|https?:|ENOENT|EACCES|exited with code)/.test(
      candidate
    ) ? candidate : "编辑器处理未完成，请检查运行依赖、素材和任务状态后重试";
    emit({
      type: "error",
      code,
      message,
      retryable: cancelled2 || (known2 ? error.retryable : true)
    });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}

// native/editor-runtime.ts
await runEditorCli({ runtimeSource: source, runtimeSha: sha256 });
