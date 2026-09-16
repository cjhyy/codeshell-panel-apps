/** Correlate real 5 ms stereo-energy features. No media decoding or invented waveform data lives here. */
export interface AudioCorrelation {
  lag: number;
  confidence: number;
  secondPeak: number;
  overlap: number;
  reliable: boolean;
  reason?: string;
}
function fft(real: Float64Array, imag: Float64Array, inverse: boolean): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imag[i], imag[j]] = [imag[j]!, imag[i]!];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let begin = 0; begin < n; begin += size) {
      let ur = 1,
        ui = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = begin + j,
          b = a + size / 2,
          vr = real[b]! * ur - imag[b]! * ui,
          vi = real[b]! * ui + imag[b]! * ur;
        real[b] = real[a]! - vr;
        imag[b] = imag[a]! - vi;
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
function sums(values: Float32Array): [Float64Array, Float64Array] {
  const sum = new Float64Array(values.length + 1),
    squares = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) {
    sum[i + 1] = sum[i]! + values[i]!;
    squares[i + 1] = squares[i]! + values[i]! * values[i]!;
  }
  return [sum, squares];
}
export function correlateAudioFeatures(
  reference: Float32Array,
  target: Float32Array,
  maxLag: number,
  minOverlap = 400,
): AudioCorrelation {
  if (
    ![reference, target].every(
      (values) =>
        values instanceof Float32Array &&
        values.length >= minOverlap &&
        values.length <= 36000 &&
        values.every(Number.isFinite),
    ) ||
    !Number.isSafeInteger(maxLag) ||
    maxLag < 0 ||
    maxLag > 12000 ||
    !Number.isSafeInteger(minOverlap) ||
    minOverlap < 200
  )
    throw new Error("音频相关分析范围无效，至少需要一段完整声音");
  let n = 1;
  while (n < reference.length + target.length - 1) n *= 2;
  const ar = new Float64Array(n),
    ai = new Float64Array(n),
    br = new Float64Array(n),
    bi = new Float64Array(n);
  for (let i = 0; i < reference.length; i++) ar[i] = reference[reference.length - 1 - i]!;
  br.set(target);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const real = ar[i]! * br[i]! - ai[i]! * bi[i]!;
    ai[i] = ar[i]! * bi[i]! + ai[i]! * br[i]!;
    ar[i] = real;
  }
  fft(ar, ai, true);
  const [rs, rq] = sums(reference),
    [ts, tq] = sums(target),
    candidates: Array<{ lag: number; score: number; overlap: number }> = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const r0 = Math.max(0, -lag),
      r1 = Math.min(reference.length, target.length - lag),
      count = r1 - r0;
    if (count < minOverlap) continue;
    const t0 = r0 + lag,
      t1 = r1 + lag,
      sa = rs[r1]! - rs[r0]!,
      sb = ts[t1]! - ts[t0]!,
      va = rq[r1]! - rq[r0]! - (sa * sa) / count,
      vb = tq[t1]! - tq[t0]! - (sb * sb) / count;
    // Silence, constant tones and nearly flat noise floors have no usable timing landmarks.
    if (va / count < 1e-5 || vb / count < 1e-5) continue;
    const dot = ar[reference.length - 1 + lag]!,
      score = Math.max(-1, Math.min(1, (dot - (sa * sb) / count) / Math.sqrt(va * vb)));
    candidates.push({ lag, score, overlap: count });
  }
  candidates.sort(
    (a, b) => b.score - a.score || b.overlap - a.overlap || Math.abs(a.lag) - Math.abs(b.lag),
  );
  const best = candidates[0];
  if (!best)
    return {
      lag: 0,
      confidence: 0,
      secondPeak: 0,
      overlap: 0,
      reliable: false,
      reason: "声音静音或缺少可辨认的变化，请手动对齐",
    };
  const second = candidates.find((item) => Math.abs(item.lag - best.lag) > 20)?.score ?? 0;
  const reliable =
    best.score >= 0.65 &&
    best.score - second >= 0.075 &&
    !(maxLag > 0 && Math.abs(best.lag) === maxLag);
  const reason =
    best.score < 0.65
      ? "两段声音相似度不足，请选择包含共同声音的分析范围"
      : best.score - second < 0.075
        ? "声音存在重复节奏或多个相近匹配，请手动确认偏移"
        : Math.abs(best.lag) === maxLag && maxLag > 0
          ? "最佳匹配位于搜索边界，请扩大最大偏移"
          : undefined;
  return {
    lag: best.lag,
    confidence: Math.max(0, best.score),
    secondPeak: Math.max(0, second),
    overlap: best.overlap,
    reliable,
    ...(reason ? { reason } : {}),
  };
}
