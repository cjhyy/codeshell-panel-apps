function rounded(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

export function drawDemo(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
  frame: number,
): void {
  ctx.save();
  const s = Math.min(width / 1280, height / 720);
  ctx.fillStyle = "#101918";
  ctx.fillRect(0, 0, width, height);
  ctx.translate((width - 1280 * s) / 2, (height - 720 * s) / 2);
  ctx.scale(s, s);
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, "#123b35");
  gradient.addColorStop(0.55, "#112b29");
  gradient.addColorStop(1, "#111a22");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.strokeStyle = "#95c5ad0c";
  ctx.lineWidth = 1;
  for (let x = 0; x < 1280; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
    ctx.stroke();
  }
  for (let y = 0; y < 720; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#bceac9";
  ctx.font = "500 18px system-ui";
  ctx.fillText("MIMI STUDIO   /   CREATE SOMETHING GOOD", 82, 90);
  rounded(ctx, 82, 170, 124, 34, 17, "#a6e5be19");
  ctx.fillStyle = "#bceac9";
  ctx.font = "500 15px system-ui";
  ctx.fillText(["01 / THE IDEA", "02 / THE EDIT", "03 / YOUR STORY"][index % 3]!, 98, 193);
  ctx.fillStyle = "#edf7ee";
  ctx.font = "600 76px system-ui";
  ctx.fillText(["从想法，", "让每一帧，", "你的故事，"][index % 3]!, 78, 316);
  ctx.fillStyle = "#b6efca";
  ctx.fillText(["到成片。", "恰到好处。", "现在开始。 "][index % 3]!, 78, 416);
  ctx.fillStyle = "#b5c6c1";
  ctx.font = "400 23px system-ui";
  ctx.fillText("留住值得讲述的瞬间。其余的，交给剪辑。", 82, 480);
  const p = frame / 30;
  ctx.save();
  ctx.translate(957, 337);
  ctx.rotate(-0.2 + Math.sin(p * 0.3) * 0.025);
  rounded(ctx, -158, -187, 288, 370, 24, "#0b171acc");
  rounded(ctx, -141, -170, 254, 243, 12, "#397765");
  const g = ctx.createLinearGradient(-141, -170, 113, 73);
  g.addColorStop(0, "#9bd5a4");
  g.addColorStop(1, "#254e4f");
  rounded(ctx, -141, -170, 254, 243, 12, g);
  ctx.fillStyle = "#e3ecc6";
  ctx.beginPath();
  ctx.arc(38, -94, 33, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#204f45";
  ctx.beginPath();
  ctx.moveTo(-141, 73);
  ctx.lineTo(-64, -77);
  ctx.lineTo(48, 73);
  ctx.fill();
  ctx.fillStyle = "#163a37";
  ctx.beginPath();
  ctx.moveTo(-37, 73);
  ctx.lineTo(60, -34);
  ctx.lineTo(113, 73);
  ctx.fill();
  rounded(ctx, -141, 99, 157, 9, 4, "#d9e9e0");
  rounded(ctx, -141, 122, 225, 6, 3, "#45655a");
  rounded(ctx, -141, 140, 178, 6, 3, "#45655a");
  ctx.restore();
  rounded(ctx, 827, 506, 271, 59, 12, "#b9edc6");
  ctx.fillStyle = "#173c2d";
  ctx.font = "500 19px system-ui";
  ctx.fillText("▶   Made of little moments", 845, 543);
  ctx.fillStyle = "#8dafa0";
  ctx.font = "400 15px system-ui";
  ctx.fillText("示例画面 · 可自由剪辑与导出", 82, 643);
  ctx.restore();
}
