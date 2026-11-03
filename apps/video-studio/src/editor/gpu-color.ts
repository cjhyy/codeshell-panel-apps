import { evaluateColorCurve, type ResolvedColorAdjustment } from "./color";

/** Preview-only colour grading on the GPU. It follows `applyColorToRgba` step by step;
 * curves become a lookup texture. Output can differ from the CPU path by a rounding step,
 * so export keeps the CPU path. Returns false whenever WebGL2 is unavailable. */
const MAX_BANDS = 24,
  LUT_SIZE = 4096;

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D picture;
uniform sampler2D curves;
uniform vec3 gains;
uniform float contrast, brightness, hue, saturation;
uniform bool useHsl;
uniform int bandCount;
uniform vec4 bands[${MAX_BANDS}];
uniform float bandLightness[${MAX_BANDS}];
const float LUT = ${LUT_SIZE}.0;

float wrap(float degrees) { return mod(mod(degrees, 360.0) + 360.0, 360.0); }
vec3 rgbToHsl(vec3 c) {
  float high = max(c.r, max(c.g, c.b)), low = min(c.r, min(c.g, c.b));
  float l = (high + low) / 2.0, delta = high - low;
  if (delta == 0.0) return vec3(0.0, 0.0, l);
  float s = delta / (1.0 - abs(2.0 * l - 1.0));
  float h = high == c.r ? (c.g - c.b) / delta : high == c.g ? (c.b - c.r) / delta + 2.0 : (c.r - c.g) / delta + 4.0;
  return vec3(wrap(h * 60.0), s, l);
}
vec3 hslToRgb(float h, float s, float l) {
  float sector = wrap(h) / 60.0;
  float chroma = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = chroma * (1.0 - abs(mod(sector, 2.0) - 1.0));
  float m = l - chroma / 2.0;
  vec3 rgb = sector < 1.0 ? vec3(chroma, x, 0.0) : sector < 2.0 ? vec3(x, chroma, 0.0)
    : sector < 3.0 ? vec3(0.0, chroma, x) : sector < 4.0 ? vec3(0.0, x, chroma)
    : sector < 5.0 ? vec3(x, 0.0, chroma) : vec3(chroma, 0.0, x);
  return rgb + m;
}
float tone(float value, int channel) {
  float at = (clamp(value, 0.0, 1.0) * (LUT - 1.0) + 0.5) / LUT;
  return texture(curves, vec2(at, 0.5))[channel];
}
void main() {
  // Texture row 0 is the picture's top row; framebuffer row 0 is its bottom row.
  vec4 source = texture(picture, vec2(uv.x, 1.0 - uv.y));
  if (source.a == 0.0) { color = source; return; }
  vec3 c = clamp((source.rgb * gains - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0);
  if (useHsl) {
    vec3 hsl = rgbToHsl(c);
    float hueDelta = hue, saturationDelta = 0.0, lightnessDelta = 0.0;
    if (hsl.y > 0.0)
      for (int i = 0; i < ${MAX_BANDS}; i++) {
        if (i >= bandCount) break;
        vec4 band = bands[i];
        float distance = min(wrap(hsl.x - band.x), wrap(band.x - hsl.x));
        float weight = distance >= band.y / 2.0 ? 0.0 : (1.0 + cos(6.283185307179586 * distance / band.y)) / 2.0;
        hueDelta += band.z * weight;
        saturationDelta += band.w * weight;
        lightnessDelta += bandLightness[i] * weight;
      }
    c = hslToRgb(hsl.x + hueDelta, clamp(hsl.y * saturation + saturationDelta, 0.0, 1.0),
      clamp(hsl.z + lightnessDelta, 0.0, 1.0));
  }
  color = vec4(tone(c.r, 0), tone(c.g, 1), tone(c.b, 2), source.a);
}`;

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class GpuColorGrader {
  private canvas?: OffscreenCanvas;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private picture?: WebGLTexture;
  private curves?: WebGLTexture;
  private curveKey = "";
  private failed = false;

  private setup(): WebGL2RenderingContext | undefined {
    if (this.failed) return undefined;
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    try {
      this.canvas = new OffscreenCanvas(1, 1);
      const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true });
      if (!gl) throw new Error("WebGL2 unavailable");
      const shader = (type: number, source: string) => {
        const value = gl.createShader(type)!;
        gl.shaderSource(value, source);
        gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) ?? "shader");
        return value;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
      gl.useProgram(program);
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const texture = (unit: number) => {
        const value = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, unit ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, unit ? gl.LINEAR : gl.NEAREST);
        return value;
      };
      this.picture = texture(0);
      this.curves = texture(1);
      gl.uniform1i(gl.getUniformLocation(program, "picture"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "curves"), 1);
      this.gl = gl;
      this.program = program;
      this.curveKey = "";
      return gl;
    } catch {
      this.failed = true;
      return undefined;
    }
  }

  private uploadCurves(gl: WebGL2RenderingContext, color: ResolvedColorAdjustment): void {
    const key = JSON.stringify(color.curves);
    if (key === this.curveKey) return;
    const byChannel = new Map(color.curves.map((curve) => [curve.channel, curve.points])),
      master = byChannel.get("rgb"),
      table = new Float32Array(LUT_SIZE * 4);
    for (let i = 0; i < LUT_SIZE; i++) {
      const input = i / (LUT_SIZE - 1),
        value = master ? evaluateColorCurve(master, input) : input;
      (["red", "green", "blue"] as const).forEach((channel, offset) => {
        const specific = byChannel.get(channel);
        table[i * 4 + offset] = specific ? evaluateColorCurve(specific, value) : value;
      });
      table[i * 4 + 3] = 1;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curves!);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, table);
    // RGBA32F is not filterable without an extension; sample exact entries then.
    if (!gl.getExtension("OES_texture_float_linear")) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    this.curveKey = key;
  }

  /** Grades the context's whole backing store in place; false leaves it untouched. */
  grade(target: Context2D, color: ResolvedColorAdjustment): boolean {
    const gl = this.setup();
    if (!gl || !this.program || color.hsl.length > MAX_BANDS) return false;
    const width = target.canvas.width,
      height = target.canvas.height;
    try {
      this.canvas!.width = width;
      this.canvas!.height = height;
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.picture!);
      // Straight alpha, as getImageData would read it; grading never changes alpha.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target.canvas);
      this.uploadCurves(gl, color);
      const exposure = 2 ** color.exposure,
        uniform = (name: string) => gl.getUniformLocation(this.program!, name);
      gl.uniform3f(uniform("gains"),
        exposure * (1 + color.temperature * 0.25 + color.tint * 0.1),
        exposure * (1 - color.tint * 0.2),
        exposure * (1 - color.temperature * 0.25 + color.tint * 0.1));
      gl.uniform1f(uniform("contrast"), color.contrast);
      gl.uniform1f(uniform("brightness"), color.brightness);
      gl.uniform1f(uniform("hue"), color.hue);
      gl.uniform1f(uniform("saturation"), color.saturation);
      gl.uniform1i(uniform("useHsl"), color.hue !== 0 || color.saturation !== 1 || color.hsl.length ? 1 : 0);
      gl.uniform1i(uniform("bandCount"), color.hsl.length);
      if (color.hsl.length) {
        gl.uniform4fv(uniform("bands"), color.hsl.flatMap((band) => [band.hue, band.width, band.hueShift, band.saturation]));
        gl.uniform1fv(uniform("bandLightness"), color.hsl.map((band) => band.lightness));
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (gl.isContextLost()) return false;
      target.save();
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = "copy";
      target.drawImage(this.canvas!, 0, 0);
      target.restore();
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = undefined;
    this.program = undefined;
    this.canvas = undefined;
  }
}
