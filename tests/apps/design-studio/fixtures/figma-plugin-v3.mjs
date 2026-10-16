import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { normalizeDesignDocument } from "../../../../apps/design-studio/app/document.mjs";
import { createDesignResourcePersistencePlan } from "../../../../apps/design-studio/app/resource-store.mjs";
import { createPortableDesign } from "../../../../apps/design-studio/app/portable-backup.mjs";
import { createPrototype } from "../../../../apps/design-studio/app/prototype.mjs";
const hash = async (bytes) => createHash("sha256").update(bytes).digest("hex");
export const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const basic = (id, type, properties = {}) => ({
  id,
  type,
  name: id,
  x: 30,
  y: 40,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  fill: "#ffffff",
  stroke: "transparent",
  strokeWidth: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
  ...properties,
});
export function plainFixture() {
  return {
    format: "codeshell.design",
    version: 3,
    name: "Editable file",
    canvas: { width: 800, height: 600, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "home",
    pages: [
      {
        id: "home",
        name: "Home",
        children: [
          basic("card", "frame", {
            layout: "horizontal",
            gap: 12,
            padding: 16,
            alignItems: "center",
            justifyContent: "start",
            children: [
              basic("title", "text", {
                x: 46,
                y: 56,
                text: "Direct v3",
                fontSize: 20,
                fontWeight: 400,
                lineHeight: 1.2,
                textAlign: "left",
                fontFamily: "Inter",
                notes: '{"format":"codeshell.html.semantic","version":1,"tag":"h1"}',
              }),
            ],
          }),
        ],
      },
      {
        id: "detail",
        name: "Detail",
        children: [basic("marker", "rectangle", { fill: "#2563eb" })],
      },
    ],
  };
}
export async function portableFixture({
  imageMime = "image/png",
  imageBase64 = pixel,
  fontMime = "font/woff2",
  fontBase64 = Buffer.from("wOF2font-fixture").toString("base64"),
} = {}) {
  const image = await createDesignResourcePersistencePlan({
    id: "photo",
    kind: "image",
    mime: imageMime,
    base64: imageBase64,
    sha256Bytes: hash,
  });
  const font = await createDesignResourcePersistencePlan({
    id: "font",
    kind: "font",
    mime: fontMime,
    family: "Fixture",
    base64: fontBase64,
    sha256Bytes: hash,
  });
  const source = plainFixture();
  source.resources = [image.descriptor, font.descriptor];
  source.pages[0].children[0].children[0].fontRef = "font";
  source.pages[1].children.push(
    basic("photo-node", "image", { imageRef: "photo", objectFit: "cover" }),
  );
  const document = normalizeDesignDocument(source),
    path = "designs/source.codesign.json";
  const comments = JSON.stringify({
    format: "codeshell.design.comments",
    version: 1,
    designPath: path,
    threads: [],
  });
  const files = new Map([...image.parts, ...font.parts].map((part) => [part.path, part.content]));
  files.set("designs/source.comments.json", comments);
  return JSON.parse(
    await createPortableDesign({
      document,
      source: { workspaceRoot: "/private/source", sessionId: "project", path },
      readText: async (path) => {
        assert(files.has(path));
        return files.get(path);
      },
      sha256Bytes: hash,
      includeComments: true,
      attachments: [
        {
          kind: "prototype",
          suffix: ".prototype.json",
          content: JSON.stringify(createPrototype(document)),
        },
      ],
    }),
  );
}
