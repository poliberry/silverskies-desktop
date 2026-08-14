/** Single-bin DFT magnitude via the Goertzel algorithm — much cheaper than a
 * full FFT when only one or two specific frequencies matter, which is all
 * AFSK mark/space tone detection needs (see same-decoder.ts). */
export function goertzelMagnitude(samples: Float32Array, targetFreq: number, sampleRate: number): number {
  const k = Math.round((samples.length * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / samples.length;
  const cosine = Math.cos(omega);
  const coeff = 2 * cosine;

  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < samples.length; i++) {
    q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * cosine;
  const imag = q2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag);
}
