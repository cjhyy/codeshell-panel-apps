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
    var Transform = __require("stream").Transform;
    var PassThrough = __require("stream").PassThrough;
    var Writable = __require("stream").Writable;
    var crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : require_crc32();
    exports.open = open5;
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
        open5(path, { ...options2, lazyEntries: true }, function(err, zipfile) {
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
    function open5(path, options2, callback) {
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
    function dosDateTimeToDate(date, time, timezone) {
      var day = date & 31;
      var month = (date >> 5 & 15) - 1;
      var year = (date >> 9 & 127) + 1980;
      var millisecond = 0;
      var second = (time & 31) * 2;
      var minute = time >> 5 & 63;
      var hour = time >> 11 & 31;
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
    util.inherits(AssertByteCountStream, Transform);
    function AssertByteCountStream(byteCount) {
      Transform.call(this);
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
      readStream.on("error", function(error2) {
        callback(error2);
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
    var Transform = __require("stream").Transform;
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
      var time = 0;
      time |= Math.floor(jsDate.getSeconds() / 2);
      time |= (jsDate.getMinutes() & 63) << 5;
      time |= (jsDate.getHours() & 31) << 11;
      return { date, time };
    }
    function writeUInt64LE(buffer, n, offset) {
      var high = Math.floor(n / 4294967296);
      var low = n % 4294967296;
      buffer.writeUInt32LE(low, offset);
      buffer.writeUInt32LE(high, offset + 4);
    }
    util.inherits(ByteCounter, Transform);
    function ByteCounter(options2) {
      Transform.call(this, options2);
      this.byteCount = 0;
    }
    ByteCounter.prototype._transform = function(chunk, encoding, cb) {
      this.byteCount += chunk.length;
      cb(null, chunk);
    };
    util.inherits(Crc32Watcher, Transform);
    function Crc32Watcher(options2) {
      Transform.call(this, options2);
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

// native/editor-sync/provider.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { link as link2, lstat as lstat4, mkdir as mkdir3, open as open4, opendir, rm as rm3 } from "node:fs/promises";
import { join as join4 } from "node:path";

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
function tickFromBigInt(value) {
  if (value < 0n || value > MAX_TICK) throw new Error("时间超过安全整数刻度范围");
  return Number(value);
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
    const time = assertTick(point.time, "局部时间");
    const source = assertTick(point.source, "源时间");
    if (time <= previous || time > duration) throw new Error("时间映射的局部时间必须严格递增");
    if (source > sourceDuration) throw new Error("时间映射超出素材时长");
    previous = time;
    return { time, source };
  });
  if (points[0].time !== 0 || points.at(-1).time !== duration)
    throw new Error("时间映射必须覆盖片段的完整时长");
  return { points };
}
function interpolateSource(a, b, time) {
  const width = BigInt(b.time - a.time);
  const elapsed = BigInt(time - a.time);
  const numerator = BigInt(a.source) * (width - elapsed) + BigInt(b.source) * elapsed;
  return tickFromBigInt((2n * numerator + width) / (2n * width));
}
function sourceTimeAt(map, time) {
  assertTick(time, "局部时间");
  if (map.points.length < 2) throw new Error("时间映射缺少节点");
  if (time <= map.points[0].time) return map.points[0].source;
  if (time >= map.points.at(-1).time) return map.points.at(-1).source;
  let left = 0, right = map.points.length - 1;
  while (left + 1 < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (map.points[middle].time <= time) left = middle;
    else right = middle;
  }
  return interpolateSource(map.points[left], map.points[right], time);
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
    const time = assertTick(data.time, "关键帧时间");
    if (time <= previous || duration !== void 0 && time > duration)
      throw new Error("关键帧时间必须严格递增且位于动画时长内");
    previous = time;
    return {
      time,
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
  const frameRate = rate(data.frameRate);
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
    frameRate,
    container,
    videoCodec,
    audioCodec,
    quality,
    audioBitrate,
    sampleRate: 48e3,
    includeCaptions: data.includeCaptions
  };
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
    const array2 = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array2 ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("工程数据必须是普通对象或数组");
    ancestors.add(item);
    try {
      const result = array2 ? [] : {};
      const keys = Reflect.ownKeys(item);
      if (array2 && keys.length !== item.length + 1)
        throw new Error("工程数组不能有空洞或额外属性");
      for (const key of keys) {
        if (array2 && key === "length") continue;
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("工程包含不安全的数据键");
        characters += key.length;
        if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error("工程文字超过容量限制");
        if (array2 && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("工程数组包含额外属性");
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
function text(value, max, label2, empty = false, multiline = false) {
  if (typeof value !== "string" || value.length > max || !empty && !value.trim() || controls.test(value) || !multiline && /[\n\r\t]/.test(value))
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
  let resourceId;
  if (data.resourceId !== void 0) {
    resourceId = text(data.resourceId, 256, "素材资源 ID");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(resourceId))
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
    ...resourceId === void 0 ? {} : { resourceId },
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
    const assetId = id(data.assetId, "片段素材 ID"), source = assets.get(assetId);
    if (!source) throw new Error(`片段引用不存在的素材：${assetId}`);
    const mapping = timeMap(data.timeMap, duration, source.duration);
    if (source.kind !== "image") assertNoEmptyHold(mapping, source.duration, "媒体片段");
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
      const time = integer2(change.time, 0, duration - 1, "机位切换时间");
      if (time <= previous) throw new Error("机位切换时间必须严格递增");
      previous = time;
      const angleId = id(change.angleId, "切换机位 ID");
      if (!anglesById.has(angleId)) throw new Error("切换引用不存在的机位");
      return { time, angleId };
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
    const time = tick(marker.time, "标记时间"), duration = tick(marker.duration, "标记范围");
    if (time + duration > MAX_EDITOR_TICK) throw new Error("标记范围超过 24 小时");
    return {
      id: id(marker.id, "标记 ID"),
      time,
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
  const source = assets.get(clip2.assetId);
  return source.kind === "audio" ? track2.kind === "audio" : source.kind === "video" ? track2.kind !== "text" : track2.kind === "video";
}
function multicamBounds(clip2, assets) {
  const angles = new Map(clip2.angles.map((angle) => [angle.id, angle]));
  function range(angleId, start, end) {
    const angle = angles.get(angleId), source = assets.get(angle.assetId);
    const coordinates = [
      sourceTimeAt(clip2.timeMap, start),
      ...clip2.timeMap.points.filter((point) => point.time > start && point.time < end).map((point) => point.source),
      sourceTimeAt(clip2.timeMap, end)
    ];
    if (coordinates.some(
      (position) => position + angle.offset < 0 || position + angle.offset > source.duration
    ))
      throw new Error(`机位 ${angle.name} 的画面或声音范围超出素材`);
    if (coordinates.some(
      (position, index) => index > 0 && position + angle.offset === source.duration && coordinates[index - 1] + angle.offset === source.duration
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
      const source = sequences.get(clip2.sequenceId);
      if (!source) throw new Error(`嵌套引用不存在的序列：${clip2.sequenceId}`);
      const sourceDuration = sequenceDuration(source);
      if (!sourceDuration) throw new Error("嵌套片段不能引用空序列");
      validateTimeMap(clip2.timeMap, clip2.duration, sourceDuration);
      assertNoEmptyHold(clip2.timeMap, sourceDuration, "嵌套片段");
    }
    if (clip2.kind === "multicam") multicamBounds(clip2, assets);
    if ("audio" in clip2 && clip2.audio.ducking)
      for (const trackId of clip2.audio.ducking.sidechainTrackIds) {
        const source = tracks.get(trackId);
        if (!source || source.kind === "text" || source.id === clip2.trackId)
          throw new Error("压低背景声须引用其他有效声音轨道");
      }
    if (clip2.kind === "text" && clip2.sourceBinding) {
      const binding = clip2.sourceBinding, source = clips.get(binding.clipId);
      if (!source || !("timeMap" in source)) throw new Error("字幕来源须引用有效的媒体或序列片段");
      const sourceSequence = source.kind === "sequence" ? sequences.get(source.sequenceId) : void 0;
      if (source.kind === "sequence" && !sourceSequence)
        throw new Error("字幕来源引用不存在的嵌套序列");
      const sourceDuration = source.kind === "media" ? assets.get(source.assetId).duration : source.kind === "sequence" ? sequenceDuration(sourceSequence) : MAX_EDITOR_TICK;
      if (binding.sourceEnd > sourceDuration) throw new Error("字幕来源范围超出素材");
      if (binding.provenance) {
        let leaf = source;
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
function portableMediaPath(sha256) {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) invalid("素材 SHA-256 无效");
  return `media/${sha256}`;
}
function validatePortableProjectManifest(value) {
  const data = object5(value, ["format", "formatVersion", "document", "media"], "工程包清单");
  if (data.format !== PORTABLE_PROJECT_FORMAT) invalid("不是 Mimi 视频工程包");
  if (data.formatVersion !== PORTABLE_PROJECT_VERSION)
    throw new PortableProjectError(
      "UNSUPPORTED_BUNDLE_VERSION",
      `不支持的工程包版本：${String(data.formatVersion)}`
    );
  const document = validateEditorDocument(data.document);
  if (document.assets.length > MAX_PORTABLE_MEDIA)
    invalid(`工程最多包含 ${MAX_PORTABLE_MEDIA} 个素材`);
  const assets = new Map(document.assets.map((asset2) => [asset2.id, asset2]));
  const hashes = /* @__PURE__ */ new Set(), bound = /* @__PURE__ */ new Set();
  const media = array(data.media, "素材清单").map((value2) => {
    const item = object5(value2, ["sha256", "bytes", "assetIds"], "素材记录");
    portableMediaPath(item.sha256);
    const sha256 = item.sha256;
    if (hashes.has(sha256)) invalid(`素材摘要重复：${sha256}`);
    hashes.add(sha256);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1)
      invalid("素材大小必须是正整数");
    const assetIds = array(item.assetIds, "素材引用", 1).map((id3) => {
      if (typeof id3 !== "string") invalid("素材引用必须是 ID");
      const asset2 = assets.get(id3);
      if (!asset2 || asset2.kind === "demo" || bound.has(id3))
        invalid(`素材引用无效或重复：${String(id3)}`);
      if (asset2.fingerprint && asset2.fingerprint !== sha256)
        invalid(`素材摘要与工程不一致：${id3}`);
      bound.add(id3);
      return id3;
    });
    return { sha256, bytes: item.bytes, assetIds };
  });
  const missing = document.assets.filter((asset2) => asset2.kind !== "demo" && !bound.has(asset2.id));
  if (missing.length)
    throw new PortableProjectError(
      "MISSING_MEDIA",
      "工程包没有包含全部原始素材",
      missing.map((asset2) => ({ assetId: asset2.id, message: `缺少素材：${asset2.name}` }))
    );
  return {
    format: PORTABLE_PROJECT_FORMAT,
    formatVersion: PORTABLE_PROJECT_VERSION,
    document,
    media
  };
}

// native/editor-runtime/bundle.ts
import {
  constants,
  createWriteStream,
  open as openFd,
  close as closeFd,
  fstat as statFd
} from "node:fs";
import { link, lstat as lstat2, open as open2, rm as rm2 } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join as join2, relative as relative2, sep as sep2 } from "node:path";
var yauzl = __toESM(require_yauzl(), 1);
var yazl = __toESM(require_yazl(), 1);

// native/editor-runtime/files.ts
import { copyFile, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// src/editor/waveform.ts
var WAVEFORM_LIMITS = Object.freeze({
  bins: 65536,
  bytes: 768 * 1024,
  sampleRate: 48e3,
  seconds: 86400
});

// src/editor/task-bridge.ts
var EDITOR_TASK_LIMITS = Object.freeze({
  resourcesPerTask: 128,
  inputBytes: 2 * 1024 * 1024,
  documentBytes: 32 * 1024 * 1024,
  chunkBytes: 512 * 1024,
  snapshotResources: 1e4,
  proxiesPerTask: 120
});

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

// native/editor-runtime/files.ts
async function sealed(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new EditorTaskError("INVALID_DIRECTORY", "任务目录不是授权的普通目录");
  return realpath(path);
}
async function directory(root, parts) {
  let path = root;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录无效");
    path = join(path, part);
    await mkdir(path, { mode: 448 }).catch((error2) => {
      if (error2.code !== "EEXIST") throw error2;
    });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path)
      throw new EditorTaskError("INVALID_DIRECTORY", "任务子目录已变化");
  }
  return path;
}
async function regular(root, parts) {
  let path = root;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === "." || part === "..")
      throw new EditorTaskError("INVALID_FILE", "任务文件名无效");
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink())
      throw new EditorTaskError("INVALID_FILE", "任务材料不能使用符号链接");
  }
  const canonical = await realpath(path);
  if (!canonical.startsWith(root + sep) || !(await stat(canonical)).isFile())
    throw new EditorTaskError("INVALID_FILE", "任务材料不在授权目录内");
  return canonical;
}

// native/editor-runtime/bundle.ts
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
var fail = (code, message) => {
  throw new PortableProjectError(code, message);
};
function abort(signal) {
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
  abort(options2.signal);
  if (!options2.sourceRoots.length || options2.sourceRoots.length > 16)
    fail("INVALID_DIRECTORY", "必须提供 Host 材料目录白名单");
  return {
    root: await sealed(options2.workDir),
    roots: await Promise.all(options2.sourceRoots.map(sealed))
  };
}
async function sourcePath(path, roots) {
  if (!isAbsolute(path)) fail("INVALID_FILE", "材料路径必须由 Host 物化");
  for (const root of roots) {
    const part = relative2(root, path);
    if (part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep2}`))
      return regular(root, part.split(sep2));
  }
  return fail("INVALID_FILE", "材料路径不在 Host 授权目录中");
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
async function readEntry(zip, entry, signal, consume) {
  abort(signal);
  const stream = await zip.openReadStreamPromise(entry);
  let bytes = 0, crc = 4294967295;
  const stop = () => stream.destroy(new DOMException("工程包任务已取消", "AbortError"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of stream) {
      abort(signal);
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
      constants.O_RDONLY | constants.O_NOFOLLOW,
      (error2, fd2) => error2 ? reject(error2) : resolve(fd2)
    )
  );
  let zip, extraction, succeeded = false;
  try {
    const inputInfo = await new Promise(
      (resolve, reject) => statFd(fd, (error2, info) => error2 ? reject(error2) : resolve(info))
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
    zip.on("error", (error2) => {
      readerError = error2;
    });
    const centralStart = zip.readEntryCursor;
    if (zip.entryCount > limits.maxMedia + 1) fail("LIMIT_EXCEEDED", "ZIP 条目数量超过限制");
    const entries = /* @__PURE__ */ new Map(), ranges = [];
    let expanded = 0;
    for await (const entry of zip.eachEntry()) {
      abort(options2.signal);
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
    extraction = await directory(root, [`bundle-import-${randomUUID()}`]);
    const mediaRoot = await directory(extraction, ["media"]), media = [];
    let extracted = 0;
    for (const item of manifest.media) {
      abort(options2.signal);
      const path = join2(mediaRoot, item.sha256), output = await open2(path, "wx", 384), hash = createHash("sha256");
      try {
        await readEntry(
          zip,
          entries.get(portableMediaPath(item.sha256)),
          options2.signal,
          async (chunk) => {
            hash.update(chunk);
            await output.writeFile(chunk);
          }
        );
        if (hash.digest("hex") !== item.sha256)
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
    abort(options2.signal);
    if (readerError) throw readerError;
    succeeded = true;
    return { manifest, document: structuredClone(manifest.document), directory: extraction, media };
  } catch (error2) {
    if (error2 instanceof PortableProjectError || error2 instanceof Error && error2.name === "AbortError")
      throw error2;
    throw new PortableProjectError(
      "INVALID_ZIP",
      `工程包读取失败：${error2 instanceof Error ? error2.message : String(error2)}`
    );
  } finally {
    if (zip)
      await new Promise((resolve) => {
        zip.once("close", resolve);
        zip.close();
      });
    else await new Promise((resolve) => closeFd(fd, () => resolve()));
    if (!succeeded && extraction) await rm2(extraction, { recursive: true, force: true });
  }
}

// native/editor-sync/directory.ts
import { constants as constants2 } from "node:fs";
import { lstat as lstat3, mkdir as mkdir2, open as open3, realpath as realpath2 } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/editor/snapshot-sync.ts
var SNAPSHOT_FORMAT = "mimi-video-snapshot";
var SNAPSHOT_VERSION = 1;
var SYNC_LIMITS = Object.freeze({
  snapshots: 1e4,
  parents: 16,
  recordBytes: 8192,
  bundleBytes: 20 * 1024 ** 3,
  pageSize: 64
});
var SnapshotSyncError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SnapshotSyncError";
  }
  code;
};
var syncHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var syncToken = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
var fail2 = (message) => {
  throw new SnapshotSyncError("INVALID_SNAPSHOT", message);
};
function syncObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail2("同步记录必须是普通对象");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key)))
    fail2("同步记录字段缺失或不支持");
  for (const key of own) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !keys.includes(key) || !property.enumerable || !("value" in property))
      fail2("同步记录不能包含额外字段或访问器");
  }
  return value;
}
function syncArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1)
    fail2("同步记录数组超限或含空洞");
  const list2 = value;
  for (let i = 0; i < list2.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(list2, String(i));
    if (!descriptor?.enumerable || !("value" in descriptor)) fail2("同步记录数组含访问器或空洞");
  }
  return list2;
}
function snapshotCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(snapshotCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${snapshotCanonical(value[key])}`
  ).join(",")}}`;
}
async function snapshotDigest(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function validateSnapshot(value) {
  const data = syncObject(value, [
    "format",
    "formatVersion",
    "id",
    "projectId",
    "bundle",
    "parents",
    "deviceId",
    "createdAt",
    "note"
  ]);
  if (data.format !== SNAPSHOT_FORMAT) fail2("不是 Mimi 工程快照");
  if (data.formatVersion !== SNAPSHOT_VERSION)
    throw new SnapshotSyncError("UNSUPPORTED_SYNC_VERSION", "不支持的同步快照版本");
  if (!syncHash(data.id) || typeof data.projectId !== "string" || !data.projectId || data.projectId.length > 128 || /[\u0000-\u001f\u007f]/.test(data.projectId))
    fail2("快照或工程标识无效");
  const bundle = syncObject(data.bundle, ["sha256", "bytes"]);
  if (!syncHash(bundle.sha256) || !Number.isSafeInteger(bundle.bytes) || Number(bundle.bytes) < 1 || Number(bundle.bytes) > SYNC_LIMITS.bundleBytes)
    fail2("工程包摘要或大小无效");
  const parents = syncArray(data.parents, SYNC_LIMITS.parents).map((parent) => {
    if (!syncHash(parent) || parent === data.id) fail2("父快照标识无效");
    return parent;
  });
  if (new Set(parents).size !== parents.length || parents.some((parent, index) => index > 0 && parents[index - 1] >= parent))
    fail2("父快照必须去重并按摘要排序");
  if (!syncToken(data.deviceId) || typeof data.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.createdAt) || !Number.isFinite(Date.parse(data.createdAt)) || new Date(data.createdAt).toISOString() !== data.createdAt || typeof data.note !== "string" || data.note.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.note))
    fail2("快照设备、时间或备注无效");
  return {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_VERSION,
    id: data.id,
    projectId: data.projectId,
    bundle: { sha256: bundle.sha256, bytes: bundle.bytes },
    parents,
    deviceId: data.deviceId,
    createdAt: data.createdAt,
    note: data.note
  };
}
function payload(snapshot) {
  const { id: _, ...rest } = snapshot;
  return rest;
}
async function verifySnapshot(value) {
  const checked = validateSnapshot(value);
  if (await snapshotDigest(snapshotCanonical(payload(checked))) !== checked.id)
    throw new SnapshotSyncError("SNAPSHOT_HASH_MISMATCH", "快照内容与摘要不一致");
  return checked;
}
var snapshotBundlePath = (hash) => {
  if (!syncHash(hash)) fail2("工程包摘要无效");
  return `mimi-sync/v1/bundles/${hash}.mimiproject`;
};
function analyzeSnapshotGraph(values) {
  const snapshots = syncArray(values, SYNC_LIMITS.snapshots).map(validateSnapshot), byId = /* @__PURE__ */ new Map();
  for (const snapshot of snapshots) {
    if (byId.has(snapshot.id)) fail2("快照摘要重复");
    if (snapshots[0] && snapshot.projectId !== snapshots[0].projectId) fail2("快照属于不同工程");
    byId.set(snapshot.id, snapshot);
  }
  const pending = /* @__PURE__ */ new Set(), referenced = /* @__PURE__ */ new Set(), done = /* @__PURE__ */ new Set();
  for (const snapshot of snapshots) {
    if (done.has(snapshot.id)) continue;
    const stack = [{ id: snapshot.id, exit: false }], active = /* @__PURE__ */ new Set();
    while (stack.length) {
      const frame = stack.pop();
      if (frame.exit) {
        active.delete(frame.id);
        done.add(frame.id);
        continue;
      }
      if (active.has(frame.id)) fail2("快照父关系包含循环");
      if (done.has(frame.id)) continue;
      const item = byId.get(frame.id);
      if (!item) {
        pending.add(frame.id);
        continue;
      }
      active.add(frame.id);
      stack.push({ id: frame.id, exit: true });
      for (const parent of item.parents) {
        referenced.add(parent);
        stack.push({ id: parent, exit: false });
      }
    }
  }
  return {
    snapshots: [...snapshots].sort((a, b) => a.id.localeCompare(b.id)),
    heads: snapshots.filter((snapshot) => !referenced.has(snapshot.id)).map((snapshot) => snapshot.id).sort(),
    missingParents: [...pending].sort(),
    complete: pending.size === 0
  };
}

// native/editor-sync/directory.ts
var changed = () => {
  throw new SnapshotSyncError("DIRECTORY_CHANGED", "同步目录已被替换或包含符号链接，请重新连接");
};
var sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
async function openSyncDirectory(root, components, create, signal) {
  const held = [];
  const close = async () => {
    await Promise.all(held.map((item) => item.handle.close().catch(() => {
    })));
  };
  const verify = async (cleaning = false) => {
    if (!cleaning) signal.throwIfAborted();
    for (const item of held) {
      const current = await lstat3(item.path);
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, item.identity))
        changed();
    }
  };
  try {
    const original = await lstat3(root);
    if (!original.isDirectory() || original.isSymbolicLink()) changed();
    let current = await realpath2(root);
    for (let index = -1; index < components.length; index++) {
      if (index >= 0 && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(components[index])) changed();
      await verify();
      if (index >= 0) current = join3(current, components[index]);
      const parent = held.at(-1), path = parent && process.platform === "linux" ? `/proc/self/fd/${parent.handle.fd}/${components[index]}` : current;
      if (index >= 0 && create)
        await mkdir2(path, { mode: 448 }).catch((error2) => {
          if (error2.code !== "EEXIST") throw error2;
        });
      const handle = await open3(
        path,
        constants2.O_RDONLY | (constants2.O_NOFOLLOW ?? 0) | (constants2.O_DIRECTORY ?? 0) | (constants2.O_NONBLOCK ?? 0)
      );
      const identity = await handle.stat().catch(async (error2) => {
        await handle.close();
        throw error2;
      });
      held.push({ path: current, handle, identity });
      if (!identity.isDirectory() || index === -1 && !sameIdentity(identity, original)) changed();
    }
    await verify();
    const leaf = held.at(-1);
    return {
      path: leaf.path,
      location: (name) => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) changed();
        return process.platform === "linux" ? `/proc/self/fd/${leaf.handle.fd}/${name}` : join3(leaf.path, name);
      },
      verify,
      sync: async () => {
        await verify(true);
        await leaf.handle.sync();
      },
      close
    };
  } catch (error2) {
    await close();
    throw error2;
  }
}
async function openSyncFile(directory2, name) {
  await directory2.verify();
  const path = directory2.location(name), info = await lstat3(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new SnapshotSyncError("UNSAFE_FILE", "同步对象不是普通文件");
  const file = await open3(
    path,
    constants2.O_RDONLY | (constants2.O_NOFOLLOW ?? 0) | (constants2.O_NONBLOCK ?? 0)
  );
  try {
    const opened = await file.stat();
    if (!opened.isFile() || !sameIdentity(opened, info)) changed();
    await directory2.verify();
    return { file, info: opened, path };
  } catch (error2) {
    await file.close();
    throw error2;
  }
}

// native/editor-sync/provider.ts
var error = (code, message) => {
  throw new SnapshotSyncError(code, message);
};
var id2 = (value) => {
  if (typeof value !== "string" || !value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value))
    error("INVALID_REQUEST", "工程标识无效");
  return value;
};
function validateSyncRequest(value) {
  if (!value || typeof value !== "object") return error("INVALID_REQUEST", "同步请求无效");
  const action = Object.getOwnPropertyDescriptor(value, "action");
  if (!action || !("value" in action)) return error("INVALID_REQUEST", "同步请求无效");
  if (action.value === "history") {
    const data = syncObject(value, ["action", "projectId", "after", "inventory"]);
    if (data.after !== null && !syncHash(data.after) || data.inventory !== null && !syncHash(data.inventory))
      return error("INVALID_REQUEST", "同步分页标识无效");
    return {
      action: "history",
      projectId: id2(data.projectId),
      after: data.after,
      inventory: data.inventory
    };
  }
  if (action.value === "pull") {
    const data = syncObject(value, ["action", "projectId", "snapshotId"]);
    if (!syncHash(data.snapshotId)) return error("INVALID_REQUEST", "快照标识无效");
    return { action: "pull", projectId: id2(data.projectId), snapshotId: data.snapshotId };
  }
  if (action.value === "publication-status") {
    const data = syncObject(value, ["action", "snapshot", "incomingToken"]);
    if (!syncToken(data.incomingToken)) return error("INVALID_REQUEST", "传输标识无效");
    return {
      action: "publication-status",
      snapshot: data.snapshot,
      incomingToken: data.incomingToken
    };
  }
  if (action.value === "publish") {
    const data = syncObject(value, ["action", "snapshot", "incomingToken"]);
    if (data.incomingToken !== null && !syncToken(data.incomingToken))
      return error("INVALID_REQUEST", "传输标识无效");
    return {
      action: "publish",
      snapshot: data.snapshot,
      incomingToken: data.incomingToken
    };
  }
  if (action.value === "discard-incoming") {
    const data = syncObject(value, ["action", "token"]);
    if (!syncToken(data.token)) return error("INVALID_REQUEST", "传输标识无效");
    return { action: "discard-incoming", token: data.token };
  }
  return error("INVALID_REQUEST", "不支持的同步操作");
}
var prefix = ["mimi-sync", "v1"];
async function digestFile(directory2, name, expectedBytes, signal) {
  const opened = await openSyncFile(directory2, name), hash = createHash2("sha256"), buffer = Buffer.allocUnsafe(256 * 1024);
  let position = 0;
  try {
    if (opened.info.size !== expectedBytes)
      error("BUNDLE_SIZE_MISMATCH", "同步工程包大小不一致，可能尚未下载完成");
    while (position < expectedBytes) {
      signal.throwIfAborted();
      await directory2.verify();
      const read = await opened.file.read(
        buffer,
        0,
        Math.min(buffer.length, expectedBytes - position),
        position
      );
      if (!read.bytesRead) error("BUNDLE_SIZE_MISMATCH", "同步工程包被截断");
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const end = await opened.file.stat(), named = await lstat4(opened.path);
    if (!sameIdentity(end, named) || end.size !== opened.info.size || end.mtimeMs !== opened.info.mtimeMs || end.ctimeMs !== opened.info.ctimeMs)
      error("FILE_CHANGED", "同步文件在校验时发生变化");
    await directory2.verify();
    return { sha256: hash.digest("hex"), info: end };
  } finally {
    await opened.file.close();
  }
}
async function readSnapshot(directory2, snapshotId, projectId) {
  if (!syncHash(snapshotId)) error("INVALID_REQUEST", "快照标识无效");
  const opened = await openSyncFile(directory2, `${snapshotId}.json`);
  try {
    if (opened.info.size > SYNC_LIMITS.recordBytes) error("LIMIT_EXCEEDED", "快照记录超过大小限制");
    const buffer = Buffer.alloc(SYNC_LIMITS.recordBytes + 1), { bytesRead } = await opened.file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== opened.info.size || bytesRead > SYNC_LIMITS.recordBytes)
      error("FILE_CHANGED", "同步快照尚未完整写入");
    const snapshot = await verifySnapshot(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)))
    );
    if (snapshot.id !== snapshotId || snapshot.projectId !== projectId)
      error("PROJECT_MISMATCH", "快照文件名或工程标识不一致");
    await directory2.verify();
    return snapshot;
  } finally {
    await opened.file.close();
  }
}
async function presence(directory2, snapshot) {
  try {
    await directory2.verify();
    const info = await lstat4(directory2.location(`${snapshot.bundle.sha256}.mimiproject`));
    return !info.isFile() || info.isSymbolicLink() ? "unsafe" : info.size !== snapshot.bundle.bytes ? "size-mismatch" : "present-unverified";
  } catch (cause) {
    if (cause.code === "ENOENT") return "missing";
    throw cause;
  }
}
async function noClobberBytes(directory2, name, bytes) {
  const scratch = `pending-${randomUUID2()}.tmp`, path = directory2.location(scratch), file = await open4(path, "wx", 384);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await directory2.verify();
    try {
      await link2(path, directory2.location(name));
    } catch (cause) {
      if (cause.code !== "EEXIST") throw cause;
      const existing = await openSyncFile(directory2, name);
      try {
        if (existing.info.size !== bytes.length)
          error("IMMUTABLE_CONFLICT", "同步对象已经存在但内容不同，未覆盖");
        const read = Buffer.alloc(bytes.length + 1), result = await existing.file.read(read, 0, read.length, 0);
        if (result.bytesRead !== bytes.length || !read.subarray(0, result.bytesRead).equals(bytes))
          error("IMMUTABLE_CONFLICT", "同步对象已经存在但内容不同，未覆盖");
      } finally {
        await existing.file.close();
      }
    }
    await directory2.sync();
  } finally {
    await file.close().catch(() => {
    });
    await directory2.verify(true);
    await rm3(path, { force: true });
  }
}
async function validateBundle(root, directory2, name, snapshot, signal) {
  const checked = await digestFile(directory2, name, snapshot.bundle.bytes, signal);
  if (checked.sha256 !== snapshot.bundle.sha256)
    error("BUNDLE_HASH_MISMATCH", "同步工程包摘要不一致，请等待下载完成或从另一台设备补回");
  const scratch = await openSyncDirectory(root, [...prefix, "scratch"], true, signal), own = `verify-${randomUUID2()}`, ownPath = scratch.location(own);
  try {
    await mkdir3(ownPath, { mode: 448 });
    await directory2.verify();
    const imported = await importPortableProject({
      inputPath: join4(directory2.path, name),
      workDir: join4(scratch.path, own),
      sourceRoots: [root],
      signal
    });
    if (imported.document.id !== snapshot.projectId)
      error("PROJECT_MISMATCH", "工程包与快照属于不同工程");
    const current = await lstat4(directory2.location(name));
    if (!sameIdentity(current, checked.info) || current.size !== checked.info.size || current.mtimeMs !== checked.info.mtimeMs || current.ctimeMs !== checked.info.ctimeMs)
      error("FILE_CHANGED", "工程包在校验时被替换");
    await directory2.verify();
    return checked;
  } catch (cause) {
    if (cause instanceof PortableProjectError)
      throw new SnapshotSyncError(cause.code, cause.message);
    throw cause;
  } finally {
    try {
      await scratch.verify(true);
      await rm3(ownPath, { recursive: true, force: true });
    } finally {
      await scratch.close();
    }
  }
}
async function runSyncRequest(root, value, signal = new AbortController().signal) {
  const request = validateSyncRequest(value);
  if (request.action === "discard-incoming") {
    const incoming = await openSyncDirectory(root, [...prefix, "incoming"], true, signal);
    try {
      await incoming.verify();
      const name = `${request.token}.mimiproject`;
      const info = await lstat4(incoming.location(name)).catch((cause) => {
        if (cause.code === "ENOENT") return void 0;
        throw cause;
      });
      if (info && (!info.isFile() || info.isSymbolicLink()))
        error("UNSAFE_FILE", "暂存对象不是普通文件");
      if (info) await rm3(incoming.location(name));
      return { discarded: true };
    } finally {
      await incoming.close();
    }
  }
  const snapshot = request.action === "publish" || request.action === "publication-status" ? await verifySnapshot(request.snapshot) : void 0, projectId = snapshot?.projectId ?? request.projectId;
  const projectKey = await snapshotDigest(projectId), records = await openSyncDirectory(
    root,
    [...prefix, "projects", projectKey, "snapshots"],
    true,
    signal
  ), bundles = await openSyncDirectory(root, [...prefix, "bundles"], true, signal).catch(
    async (cause) => {
      await records.close();
      throw cause;
    }
  );
  try {
    if (request.action === "history") {
      const names = [];
      let scanned = 0;
      const listing = await opendir(records.path);
      for await (const entry of listing) {
        signal.throwIfAborted();
        if (++scanned > SYNC_LIMITS.snapshots * 2)
          error("LIMIT_EXCEEDED", "同步目录记录过多，超过本次扫描限制");
        if (/^pending-[a-f0-9-]+\.tmp$/.test(entry.name)) continue;
        if (!entry.isFile() || entry.isSymbolicLink() || !/^([a-f0-9]{64})\.json$/.test(entry.name))
          error("UNSAFE_FILE", "快照目录包含不支持的文件或链接");
        if (names.length >= SYNC_LIMITS.snapshots)
          error("LIMIT_EXCEEDED", "工程快照超过 10000 条，未返回截断历史");
        names.push(entry.name);
      }
      await records.verify();
      const ids = names.map((name) => name.slice(0, -5)).sort(), inventory = await snapshotDigest(ids.join("\n"));
      if (request.inventory !== null && request.inventory !== inventory)
        error("INVENTORY_CHANGED", "同步目录新增了快照，请刷新完整历史");
      const page = ids.filter((value2) => request.after === null || value2 > request.after).slice(0, SYNC_LIMITS.pageSize), entries = [], issues = [];
      for (const snapshotId of page) {
        signal.throwIfAborted();
        try {
          const item2 = await readSnapshot(records, snapshotId, projectId);
          entries.push({ snapshot: item2, bundleState: await presence(bundles, item2) });
        } catch (cause) {
          if (signal.aborted) throw cause;
          issues.push({
            snapshotId,
            code: cause instanceof SnapshotSyncError ? cause.code : "INVALID_SNAPSHOT"
          });
        }
      }
      await records.verify();
      return {
        inventory,
        total: ids.length,
        entries,
        issues,
        nextAfter: page.length && page.at(-1) !== ids.at(-1) ? page.at(-1) : null
      };
    }
    if (request.action === "pull") {
      const item2 = await readSnapshot(records, request.snapshotId, projectId);
      await validateBundle(root, bundles, `${item2.bundle.sha256}.mimiproject`, item2, signal);
      return {
        snapshot: item2,
        bundle: {
          path: snapshotBundlePath(item2.bundle.sha256),
          sha256: item2.bundle.sha256,
          bytes: item2.bundle.bytes
        }
      };
    }
    const item = snapshot;
    if (request.action === "publication-status") {
      const existing = await readSnapshot(records, item.id, projectId).catch((cause) => {
        if (cause.code === "ENOENT") return void 0;
        throw cause;
      });
      const present = await presence(bundles, item);
      if (present === "present-unverified") {
        await validateBundle(root, bundles, `${item.bundle.sha256}.mimiproject`, item, signal);
        return { state: existing ? "published" : "bundle-ready" };
      }
      if (present !== "missing")
        error("IMMUTABLE_CONFLICT", "已有工程包不完整或损坏，未覆盖；请从可信设备恢复");
      const incoming2 = await openSyncDirectory(root, [...prefix, "incoming"], true, signal);
      try {
        const found = await lstat4(incoming2.location(`${request.incomingToken}.mimiproject`)).catch(
          (cause) => {
            if (cause.code === "ENOENT") return void 0;
            throw cause;
          }
        );
        if (!found) return { state: "missing" };
        if (!found.isFile() || found.isSymbolicLink())
          error("UNSAFE_FILE", "同步暂存对象不是普通文件");
        if (found.size !== item.bundle.bytes) return { state: "incoming-invalid" };
        const checked = await digestFile(
          incoming2,
          `${request.incomingToken}.mimiproject`,
          item.bundle.bytes,
          signal
        );
        return {
          state: checked.sha256 === item.bundle.sha256 ? "incoming-ready" : "incoming-invalid"
        };
      } finally {
        await incoming2.close();
      }
    }
    const parents = [], queued = [...item.parents], seen = /* @__PURE__ */ new Set();
    while (queued.length) {
      signal.throwIfAborted();
      const parent = queued.pop();
      if (seen.has(parent)) continue;
      seen.add(parent);
      if (seen.size >= SYNC_LIMITS.snapshots) error("LIMIT_EXCEEDED", "快照历史超过发布限制");
      let value2;
      try {
        value2 = await readSnapshot(records, parent, projectId);
      } catch (cause) {
        if (cause.code === "ENOENT")
          error("MISSING_PARENT", "父快照尚未同步完成，未发布新版本");
        throw cause;
      }
      parents.push(value2);
      queued.push(...value2.parents);
    }
    analyzeSnapshotGraph([...parents, item]);
    const incoming = request.incomingToken ? await openSyncDirectory(root, [...prefix, "incoming"], true, signal) : void 0;
    try {
      const staged = incoming ? await lstat4(incoming.location(`${request.incomingToken}.mimiproject`)).catch((cause) => {
        if (cause.code === "ENOENT") return void 0;
        throw cause;
      }) : void 0;
      const source = staged ? incoming : bundles, sourceName = staged ? `${request.incomingToken}.mimiproject` : `${item.bundle.sha256}.mimiproject`;
      const verified = await validateBundle(root, source, sourceName, item, signal), target = `${item.bundle.sha256}.mimiproject`;
      if (incoming && staged) {
        await incoming.verify();
        await bundles.verify();
        await link2(incoming.location(sourceName), bundles.location(target)).catch(async (cause) => {
          if (cause.code !== "EEXIST") throw cause;
          const old = await digestFile(bundles, target, item.bundle.bytes, signal);
          if (old.sha256 !== item.bundle.sha256)
            error("IMMUTABLE_CONFLICT", "已有工程包损坏，未覆盖；请从可信设备恢复该摘要文件");
        });
        await bundles.sync();
        const present = await digestFile(bundles, target, item.bundle.bytes, signal);
        if (present.sha256 !== item.bundle.sha256)
          error("BUNDLE_HASH_MISMATCH", "发布后的工程包校验失败");
      }
      signal.throwIfAborted();
      await noClobberBytes(
        records,
        `${item.id}.json`,
        new TextEncoder().encode(snapshotCanonical(item))
      );
      if (incoming && staged) {
        await incoming.verify();
        const current = await lstat4(incoming.location(sourceName));
        if (sameIdentity(current, verified.info)) await rm3(incoming.location(sourceName));
      }
      return {
        snapshot: item,
        bundle: { path: snapshotBundlePath(item.bundle.sha256), ...item.bundle },
        published: true
      };
    } finally {
      await incoming?.close();
    }
  } finally {
    await Promise.all([records.close(), bundles.close()]);
  }
}

// native/editor-sync.ts
var controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
try {
  if (process.argv.length !== 2)
    throw new SnapshotSyncError("INVALID_REQUEST", "同步工具不接受命令行路径");
  const chunks = [], maximum = 32 * 1024;
  let bytes = 0;
  for await (const part of process.stdin) {
    bytes += part.length;
    if (bytes > maximum) throw new SnapshotSyncError("LIMIT_EXCEEDED", "同步请求超过限制");
    chunks.push(part);
  }
  controller.signal.throwIfAborted();
  const request = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
  );
  const value = await runSyncRequest(process.cwd(), request, controller.signal), output = JSON.stringify({ ok: true, value });
  if (Buffer.byteLength(output) > 224 * 1024)
    throw new SnapshotSyncError("LIMIT_EXCEEDED", "同步结果超过通信限制，未返回不完整数据");
  process.stdout.write(`${output}
`);
} catch (cause) {
  const code = controller.signal.aborted ? "CANCELLED" : cause instanceof SnapshotSyncError ? cause.code : cause.code === "ENOENT" ? "MISSING_OBJECT" : "SYNC_IO_ERROR";
  const message = controller.signal.aborted ? "同步已取消；已发布的不可变快照可以安全重试" : cause instanceof SnapshotSyncError ? cause.message : code === "MISSING_OBJECT" ? "同步文件尚未传到此设备，请等待或从另一台设备补回" : "同步目录暂时无法读取或写入，请检查授权、磁盘空间和下载状态";
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}
`);
  process.exitCode = 1;
}
