// Synthetic long Figma page: the same layer count and canvas extent class as a
// real imported page, without retaining its personal text or source data.
export function longFigmaSource() {
  return {
    name: "Long editable page",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Long page",
          children: [
            {
              id: "1:0",
              type: "FRAME",
              name: "Long content",
              absoluteBoundingBox: { x: -1, y: 0, width: 4458, height: 11322 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
              children: Array.from({ length: 1207 }, (_, index) => ({
                id: `2:${index}`,
                type: "RECTANGLE",
                name: `Editable item ${index + 1}`,
                absoluteBoundingBox: {
                  x: 31 + (index % 16) * 200,
                  y: 32 + Math.floor(index / 16) * 144,
                  width: 80,
                  height: 24,
                },
                fills: [{ type: "SOLID", color: { r: 0.1, g: 0.3, b: 0.7 } }],
              })),
            },
          ],
        },
      ],
    },
  };
}
