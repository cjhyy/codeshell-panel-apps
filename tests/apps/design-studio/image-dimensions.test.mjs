import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { imageByteDimensions, assertNativeImageFill } from "../../../apps/design-studio/app/image-dimensions.mjs";

const png = PNG.sync.write(new PNG({ width: 30, height: 20 }));
const gif = Buffer.from("R0lGODlhAQABAIAAAOAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
test("native fill uses bounded original PNG/GIF headers and rejects unequal aspect without rewriting", () => {
  assert.deepEqual(imageByteDimensions(png), { width: 30, height: 20 });
  assert.deepEqual(imageByteDimensions(gif), { width: 1, height: 1 });
  const node = { type: "image", objectFit: "fill", width: 60, height: 40 }, original = JSON.stringify(node);
  assertNativeImageFill(node, png); assert.equal(JSON.stringify(node), original);
  for (const dimensions of [{ width: 40, height: 60 }, { width: 60, height: 39 }, { width: Infinity, height: 40 }])
    assert.throws(() => assertNativeImageFill({ ...node, ...dimensions }, png), (error) => error.code === "NATIVE_IMAGE_FILL");
  for (const fit of ["cover", "contain"]) assert.doesNotThrow(() => assertNativeImageFill({ ...node, objectFit: fit }, new Uint8Array()));
});

test("dimension parser rejects incomplete/malformed containers and unknown bodies without DOM or network", () => {
  const unknown = [new Uint8Array(), Buffer.from("<svg width='30' height='20'/>") , Buffer.from("RIFF0000WEBP"),
    png.subarray(0, 24), png.subarray(0, png.length - 1), gif.subarray(0, gif.length - 1)];
  const oversizedChunk = Buffer.from(png); oversizedChunk.writeUInt32BE(0xffffffff, 33); unknown.push(oversizedChunk);
  const noWidth = Buffer.from(png); noWidth.writeUInt32BE(0, 16); unknown.push(noWidth);
  const enormous = Buffer.from(png); enormous.writeUInt32BE(32769, 16); unknown.push(enormous);
  const badGif = Buffer.from(gif); badGif[10] = 255; unknown.push(badGif);
  const aspectGif = Buffer.from(gif); aspectGif[12] = 1; unknown.push(aspectGif);
  const exifChunk = Buffer.alloc(12); exifChunk.write("eXIf", 4);
  const exifPng = Buffer.concat([png.subarray(0, png.length - 12), exifChunk, png.subarray(png.length - 12)]);
  assert.throws(() => imageByteDimensions(exifPng), /EXIF/u);
  for (const value of unknown) assert.throws(() => imageByteDimensions(value), (error) => error.code === "NATIVE_IMAGE_FILL");
});

test("actual CPU browser JPEG output and bounded marker scanning retain exact dimensions", async () => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  let bytes;
  try {
    const page = await browser.newPage();
    bytes = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 37; canvas.height = 23;
      const context = canvas.getContext("2d"); context.fillStyle = "#123456"; context.fillRect(0, 0, 37, 23);
      return canvas.toDataURL("image/jpeg").split(",")[1];
    }), "base64");
  } finally { await browser.close(); }
  assert.deepEqual(imageByteDimensions(bytes), { width: 37, height: 23 });
  const app1 = Buffer.from([255, 225, 0, 8, 69, 120, 105, 102, 0, 0]);
  assert.throws(() => imageByteDimensions(Buffer.concat([bytes.subarray(0, 2), app1, bytes.subarray(2)])), /APP1\/EXIF/u);
  for (const value of [bytes.subarray(0, bytes.length - 2), bytes.subarray(0, 40)])
    assert.throws(() => imageByteDimensions(value), /字节尺寸/u);
  const corrupt = Buffer.from(bytes); corrupt.writeUInt16BE(65535, 4);
  assert.throws(() => imageByteDimensions(corrupt), /字节尺寸/u);
});
