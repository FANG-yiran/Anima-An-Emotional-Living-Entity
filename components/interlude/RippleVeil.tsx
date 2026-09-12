"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * 间奏异象 · 涟漪水面（移植自 cos-design rippleWater，自包含无外部依赖）
 * - 水面配色改为近黑，与生命体纯黑页面匹配；高光保留冷青
 * - 整体不透明度由 fadeRef（0..1）驱动，与粒子渐隐同步交叉溶解
 * - 不响应指针，挂载后自动投下数滴雨涟漪
 */

type RGB = [number, number, number];

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform float u_time;
uniform vec2 u_res;
uniform vec3 u_tint;
uniform vec3 u_from;
uniform vec3 u_to;
uniform sampler2D u_height;
uniform vec2 u_sim;
uniform float u_waveAmp;
uniform float u_waveSpeed;
uniform float u_shimmer;
uniform float u_reflection;
uniform float u_fade;

varying vec2 v_uv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float ambientH(vec2 p, float t) {
  float h = 0.0;
  h += sin(p.x * 3.2 + t * 1.3) * cos(p.y * 2.4 - t * 0.9) * 0.45;
  h += sin(p.x * 6.8 - t * 1.7 + p.y * 1.1) * 0.22;
  h += sin(p.x * 12.0 + p.y * 9.0 + t * 2.4) * 0.08;
  h += sin(p.x * 1.4 + p.y * 1.8 + t * 0.55) * 0.35;
  return h;
}

float sampleHeight(vec2 uv) {
  vec2 sp = 1.0 / u_sim;
  // 5-tap 邻域平均高度场，消除雨滴中心的仿真网格摩尔纹
  float rip = texture2D(u_height, uv).r * 2.0 - 1.0;
  rip += texture2D(u_height, uv + vec2(sp.x, 0.0)).r * 2.0 - 1.0;
  rip += texture2D(u_height, uv - vec2(sp.x, 0.0)).r * 2.0 - 1.0;
  rip += texture2D(u_height, uv + vec2(0.0, sp.y)).r * 2.0 - 1.0;
  rip += texture2D(u_height, uv - vec2(0.0, sp.y)).r * 2.0 - 1.0;
  rip *= 0.2;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 2.8;
  float amb = ambientH(p, u_time * u_waveSpeed) * 0.035 * u_waveAmp;
  return rip * 0.55 + amb;
}

vec3 calcNormal(vec2 uv) {
  vec2 e = vec2(2.6 / u_sim.x, 2.6 / u_sim.y);
  float hL = sampleHeight(uv - vec2(e.x, 0.0));
  float hR = sampleHeight(uv + vec2(e.x, 0.0));
  float hD = sampleHeight(uv - vec2(0.0, e.y));
  float hU = sampleHeight(uv + vec2(0.0, e.y));
  return normalize(vec3((hL - hR) * 14.0, (hD - hU) * 14.0, 1.0));
}

void main() {
  vec2 uv = v_uv;
  vec3 n = calcNormal(uv);
  float h = sampleHeight(uv);

  vec3 V = normalize(vec3(0.0, 0.25, 1.0));
  vec3 L = normalize(vec3(0.45, 0.75, 0.55));

  float ndotl = max(dot(n, L), 0.0);
  float fresnel = pow(1.0 - max(dot(n, V), 0.0), 3.2);

  float g = clamp((uv.x + (1.0 - uv.y)) * 0.5, 0.0, 1.0);
  vec3 water = mix(u_from, u_to, g);
  water = mix(water, u_from, clamp(h * 1.8 + ndotl * 0.12, 0.0, 0.28));
  water *= 0.92 + n.y * 0.1;

  // 暗色水面：天空反射压暗，避免黑底中泛出亮蓝灰
  vec3 sky = mix(u_from * 1.15, u_tint * 1.35, 0.35);
  vec3 reflectCol = mix(sky, u_tint * 1.15, pow(max(n.y, 0.0), 2.0));
  water = mix(water, reflectCol, fresnel * u_reflection);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 180.0);
  float glitter = pow(max(dot(n, H), 0.0), 48.0);
  float sparkThresh = step(0.992, glitter) * glitter;
  vec3 sparkle = u_tint * (spec * 1.8 + sparkThresh * 2.5) * u_shimmer
    + vec3(1.0) * sparkThresh * 0.8 * u_shimmer;

  float softSpec = pow(max(dot(n, H), 0.0), 16.0) * 0.22 * u_shimmer;
  water += u_tint * softSpec + sparkle;

  float crest = smoothstep(0.02, 0.12, abs(h)) * fresnel;
  water += mix(u_tint, vec3(1.0), 0.4) * crest * 0.35;

  float vig = smoothstep(1.15, 0.35, length((uv - 0.5) * vec2(1.1, 1.0)));
  water *= 0.88 + 0.12 * vig;
  water += (hash(uv * u_res + u_time) - 0.5) * 0.015;

  gl_FragColor = vec4(water, u_fade);
}
`;

const parseHex = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return [0.1, 0.3, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string
) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (
  gl: WebGLRenderingContext,
  vert: string,
  frag: string
) => {
  const vs = createShader(gl, gl.VERTEX_SHADER, vert);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

/** 仿真网格边长 */
const SIM = 192;

interface Props {
  fadeRef: MutableRefObject<number>;
}

export default function RippleVeil({ fadeRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let width = host.clientWidth || 800;
    let height = host.clientHeight || 500;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const applySize = () => {
      width = host.clientWidth || width;
      height = host.clientHeight || height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    };
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(host);

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    // 黑底水面：左上仅一丝冷蓝，整体没入页面纯黑
    const from = parseHex("#0a0f18");
    const to = parseHex("#000000");
    const tint = parseHex("#6ee7ff");
    const waveAmp = 0.9;
    const waveSpeed = 1;
    const shimmer = 0.6;
    const reflection = 0.14;
    const damping = 0.985;
    const spread = 0.5;

    const program = createProgram(gl, VERT, FRAG);
    if (!program) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, "a_pos");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uRes = gl.getUniformLocation(program, "u_res");
    const uTint = gl.getUniformLocation(program, "u_tint");
    const uFrom = gl.getUniformLocation(program, "u_from");
    const uTo = gl.getUniformLocation(program, "u_to");
    const uHeight = gl.getUniformLocation(program, "u_height");
    const uSim = gl.getUniformLocation(program, "u_sim");
    const uWaveAmp = gl.getUniformLocation(program, "u_waveAmp");
    const uWaveSpeed = gl.getUniformLocation(program, "u_waveSpeed");
    const uShimmer = gl.getUniformLocation(program, "u_shimmer");
    const uReflection = gl.getUniformLocation(program, "u_reflection");
    const uFade = gl.getUniformLocation(program, "u_fade");

    const size = SIM * SIM;
    let prev = new Float32Array(size);
    let curr = new Float32Array(size);
    let next = new Float32Array(size);

    const heightTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const pixels = new Uint8Array(size * 4);

    const uploadHeight = () => {
      for (let i = 0; i < size; i++) {
        const v = Math.max(0, Math.min(255, Math.floor((curr[i] * 0.5 + 0.5) * 255)));
        const o = i * 4;
        pixels[o] = v;
        pixels[o + 1] = v;
        pixels[o + 2] = v;
        pixels[o + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, heightTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM, SIM, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };

    const disturb = (nx: number, ny: number, strength: number, radius: number) => {
      const cx = nx * (SIM - 1);
      const cy = ny * (SIM - 1);
      const r = clamp(radius, 2, 12);
      for (let dy = -r - 1; dy <= r + 1; dy++) {
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const x = Math.round(cx + dx);
          const y = Math.round(cy + dy);
          if (x <= 0 || x >= SIM - 1 || y <= 0 || y >= SIM - 1) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const center = Math.exp(-dist * dist * 0.55) * -0.35;
          const ring = Math.exp(-Math.pow(dist - r * 0.55, 2) * 0.9);
          curr[y * SIM + x] += strength * (center + ring * 1.1);
        }
      }
    };

    const stepSimulation = (damp: number, spd: number) => {
      const d = clamp(damp, 0.9, 0.999);
      const s = clamp(spd, 0.3, 0.7);
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 1; y < SIM - 1; y++) {
          const row = y * SIM;
          for (let x = 1; x < SIM - 1; x++) {
            const i = row + x;
            const neighbors = curr[i - 1] + curr[i + 1] + curr[i - SIM] + curr[i + SIM];
            next[i] = (neighbors * s - prev[i]) * d;
            if (next[i] > 1.5) next[i] = 1.5;
            else if (next[i] < -1.5) next[i] = -1.5;
          }
        }
        const tmp = prev;
        prev = curr;
        curr = next;
        next = tmp;
        next.fill(0);
      }
    };

    uploadHeight();
    gl.clearColor(0, 0, 0, 0);

    // 自动雨滴：挂载后错峰投下三滴，保证 3s 间奏内涟漪可见
    const drops: Array<{ at: number; x: number; y: number; strength: number }> = [
      { at: 0.15, x: 0.4, y: 0.44, strength: 0.6 },
      { at: 0.8, x: 0.63, y: 0.56, strength: 0.5 },
      { at: 1.5, x: 0.5, y: 0.36, strength: 0.42 },
    ];

    let raf = 0;
    let paused = document.hidden;
    const onVis = () => {
      paused = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    const start = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (paused) return;
      const t = (now - start) / 1000;

      while (drops.length && drops[0].at <= t) {
        const d = drops.shift()!;
        disturb(d.x, d.y, d.strength, 6);
        disturb(d.x + 0.004, d.y - 0.003, d.strength * 0.35, 6);
      }

      stepSimulation(damping, spread);
      uploadHeight();

      const fade = fadeRef.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (fade > 0.004) {
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, heightTex);
        gl.uniform1i(uHeight, 0);
        gl.uniform1f(uTime, t);
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
        gl.uniform3f(uFrom, from[0], from[1], from[2]);
        gl.uniform3f(uTo, to[0], to[1], to[2]);
        gl.uniform2f(uSim, SIM, SIM);
        gl.uniform1f(uWaveAmp, waveAmp);
        gl.uniform1f(uWaveSpeed, waveSpeed);
        gl.uniform1f(uShimmer, shimmer);
        gl.uniform1f(uReflection, reflection);
        gl.uniform1f(uFade, fade);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      gl.deleteTexture(heightTex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
    };
  }, [fadeRef]);

  return (
    <div ref={hostRef} className="veil-canvas-host">
      <canvas ref={canvasRef} className="veil-canvas" />
    </div>
  );
}
