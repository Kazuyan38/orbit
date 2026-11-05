/* ORBIT — サファイア（WebGL1・ライブラリ不使用）
   ブリリアントカットを手続き生成し、面ごとのフラット法線＋手続き環境マップの反射／屈折で輝きを近似する。
   屈折の多重反射はレイトレースせず、法線から作る擬似ハッシュで内部の明滅を出す（モバイル GPU の発熱を抑えるため）。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;

  /* ---------- 行列（列優先 Float32Array(16)） ---------- */
  const M = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, at, up) {
      let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
      let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    rotY(t) { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rotX(t) { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    translate(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
  };

  /* ---------- ブリリアントカットの形状 ---------- */
  function brilliantGeometry() {
    const N = 8;
    const TAU = Math.PI * 2;
    const ring = (count, r, y, offset) => Array.from({ length: count }, (_, i) => {
      const a = offset + (i / count) * TAU;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    });
    const tableY = 0.38, starY = 0.22, girdleT = 0.035, pavY = -0.52, culetY = -1.0;
    const T = ring(N, 0.56, tableY, 0);
    const S = ring(N, 0.84, starY, Math.PI / N);
    const G = ring(N * 2, 1.0, girdleT, 0);
    const B = ring(N * 2, 1.0, -girdleT, 0);
    const L = ring(N, 0.52, pavY, 0);
    const center = [0, tableY, 0], culet = [0, culetY, 0];
    const tris = [];
    const tri = (a, b, c) => tris.push([a, b, c]);
    const w = (i, n) => ((i % n) + n) % n;
    for (let i = 0; i < N; i++) {
      tri(center, T[i], T[w(i + 1, N)]);                         // テーブル
      tri(T[i], T[w(i + 1, N)], S[i]);                            // スター
      tri(T[i], S[w(i - 1, N)], G[2 * i]); tri(T[i], G[2 * i], S[i]); // ベゼル（カイト）
      tri(S[i], G[2 * i], G[w(2 * i + 1, 2 * N)]);                // アッパーガードル
      tri(S[i], G[w(2 * i + 1, 2 * N)], G[w(2 * i + 2, 2 * N)]);
      tri(B[w(2 * i - 1, 2 * N)], B[2 * i], L[i]);                // ロワーガードル
      tri(B[2 * i], B[w(2 * i + 1, 2 * N)], L[i]);
      tri(L[i], B[w(2 * i + 1, 2 * N)], L[w(i + 1, N)]);          // パビリオン
      tri(L[i], L[w(i + 1, N)], culet);
    }
    for (let j = 0; j < 2 * N; j++) {                              // ガードル帯
      const k = w(j + 1, 2 * N);
      tri(G[j], G[k], B[k]); tri(G[j], B[k], B[j]);
    }
    const pos = [], nrm = [], seed = [];
    tris.forEach((t, idx) => {
      const [a, b, c] = t;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
      const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 + 0.1, (a[2] + b[2] + c[2]) / 3];
      if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) n = n.map((x) => -x); // 凸形状なので外向きに揃える
      const s = (Math.sin(idx * 12.9898) * 43758.5453) % 1;
      for (const p of [a, b, c]) { pos.push(...p); nrm.push(...n); seed.push(Math.abs(s)); }
    });
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), seed: new Float32Array(seed), count: pos.length / 3 };
  }

  const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute float aSeed;
uniform mat4 uModel; uniform mat4 uVP;
varying vec3 vN; varying vec3 vW; varying float vSeed;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; vSeed = aSeed; gl_Position = uVP * w; }`;

  const FS = `
precision mediump float;
varying vec3 vN; varying vec3 vW; varying float vSeed;
uniform vec3 uCam; uniform float uTime; uniform float uPulse;
vec3 env(vec3 d){
  vec3 c = mix(vec3(0.010,0.018,0.045), vec3(0.05,0.09,0.20), smoothstep(-0.4, 0.9, d.y));
  c += vec3(0.75,0.85,1.0) * pow(max(dot(d, normalize(vec3(0.5,0.8,0.4))),0.0), 60.0) * 3.5;
  c += vec3(0.35,0.55,1.0) * pow(max(dot(d, normalize(vec3(-0.7,0.35,0.5))),0.0), 24.0) * 1.2;
  c += vec3(0.9,0.95,1.0) * pow(max(dot(d, normalize(vec3(0.1,0.2,-1.0))),0.0), 90.0) * 2.0;
  c += vec3(0.15,0.30,0.85) * smoothstep(0.92, 1.0, 1.0 - abs(d.y)) * 0.35;
  return c;
}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  vec3 T = refract(-V, N, 1.0 / 1.77);
  float F = 0.077 + (1.0 - 0.077) * pow(1.0 - ndv, 5.0);
  vec3 refl = env(R);
  // 内部: 屈折方向の環境を深い青で吸収し、面ごとの擬似乱数で明滅（内部反射の近似）
  vec3 body = vec3(0.012, 0.06, 0.42);
  float flick = 0.55 + 0.45 * sin(uTime * 0.9 + vSeed * 40.0 + dot(T, vec3(3.1, 1.7, 2.3)));
  vec3 inner = env(T * vec3(1.0, -1.0, 1.0)) * vec3(0.12, 0.30, 1.0) * 0.9 + body * (0.30 + 0.70 * flick);
  inner += vec3(0.30, 0.55, 1.0) * pow(flick, 8.0) * 0.5;
  vec3 col = mix(inner, refl, F);
  col += vec3(0.38, 0.62, 1.0) * uPulse * (0.35 + 0.65 * (1.0 - ndv));
  col = col / (1.0 + col);           // トーンマップ
  gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;

  const LINE_VS = `attribute vec3 aPos; uniform mat4 uVP; void main(){ gl_Position = uVP * vec4(aPos,1.0); }`;
  const LINE_FS = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }`;

  function compile(gl, vs, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * create(canvas, { ring }) -> controller
   * ring: { rx, rz } を渡すと軌道の楕円を描く（3D ホーム用）。
   */
  function create(canvas, opts = {}) {
    const state = { pitch: 0.32, dist: 7.2, ring: opts.ring || null, pulse: 0, running: false, raf: 0, frameCbs: [],
      vp: null, cam: [0, 0, 0], w: 1, h: 1, t0: performance.now(), lost: false, gemScale: opts.gemScale || 1 };
    let gl = null;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch (_) { gl = null; }
    if (!gl) return fallback(canvas, state);

    let prog, lineProg, buf, ringBuf, ringCount = 0, geo;
    function setup() {
      prog = compile(gl, VS, FS);
      lineProg = compile(gl, LINE_VS, LINE_FS);
      geo = brilliantGeometry();
      buf = { pos: gl.createBuffer(), nrm: gl.createBuffer(), seed: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos); gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.nrm); gl.bufferData(gl.ARRAY_BUFFER, geo.nrm, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.seed); gl.bufferData(gl.ARRAY_BUFFER, geo.seed, gl.STATIC_DRAW);
      if (state.ring) {
        const pts = [];
        const n = 160;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(Math.cos(a) * state.ring.rx, -0.05, Math.sin(a) * state.ring.rz); }
        ringBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
        ringCount = n;
      }
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
    }
    try { setup(); } catch (e) { console.warn('ORBIT: WebGL setup failed', e); return fallback(canvas, state); }

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state.lost = true; cancelAnimationFrame(state.raf); });
    canvas.addEventListener('webglcontextrestored', () => { state.lost = false; setup(); if (state.running) loop(); });

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      state.w = canvas.clientWidth; state.h = canvas.clientHeight;
    }

    function camera() {
      const aspect = state.w / Math.max(1, state.h);
      const eye = [0, Math.sin(state.pitch) * state.dist, Math.cos(state.pitch) * state.dist];
      state.cam = eye;
      // 縦長画面ではサファイアが横幅からはみ出さないよう画角を広げる
      const fov = aspect < 1 ? 2 * Math.atan(Math.tan(0.36) / aspect) : 0.72;
      state.vp = M.mul(M.perspective(fov, aspect, 0.1, 100), M.lookAt(eye, [0, 0, 0], [0, 1, 0]));
    }

    function draw(now) {
      resize();
      camera();
      const t = (now - state.t0) / 1000;
      const motion = reduceMotion.matches ? 0.08 : 1;
      const bob = Math.sin(t * 0.9) * 0.06 * motion;
      const model = M.mul(M.translate(0, bob, 0), M.mul(M.rotY(t * 0.32 * motion + 0.4), M.mul(M.rotX(0.16), scaleM(state.gemScale))));
      state.pulse *= 0.93;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(prog);
      bindAttr(prog, 'aPos', buf.pos, 3);
      bindAttr(prog, 'aNrm', buf.nrm, 3);
      bindAttr(prog, 'aSeed', buf.seed, 1);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, model);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uVP'), false, state.vp);
      gl.uniform3fv(gl.getUniformLocation(prog, 'uCam'), state.cam);
      gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), t * motion);
      gl.uniform1f(gl.getUniformLocation(prog, 'uPulse'), state.pulse);
      gl.drawArrays(gl.TRIANGLES, 0, geo.count);
      disableAttr(prog, 'aNrm'); disableAttr(prog, 'aSeed');

      if (ringBuf) {
        gl.useProgram(lineProg);
        bindAttr(lineProg, 'aPos', ringBuf, 3);
        gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'uVP'), false, state.vp);
        gl.uniform4f(gl.getUniformLocation(lineProg, 'uColor'), 0.38, 0.65, 0.98, 0.35);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.LINE_LOOP, 0, ringCount);
        gl.disable(gl.BLEND);
      }
      state.frameCbs.forEach((cb) => cb(api, t));
    }

    function scaleM(s) { return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]); }
    function bindAttr(p, name, b, size) {
      const loc = gl.getAttribLocation(p, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    function disableAttr(p, name) { const loc = gl.getAttribLocation(p, name); if (loc >= 0) gl.disableVertexAttribArray(loc); }

    function loop() {
      state.raf = requestAnimationFrame((now) => {
        if (!state.running || state.lost) return;
        draw(now);
        loop();
      });
    }

    const api = {
      webgl: true,
      start() { if (state.running) return; state.running = true; loop(); },
      stop() { state.running = false; cancelAnimationFrame(state.raf); },
      pulse() { state.pulse = 1; },
      setView({ pitch, dist }) {
        if (pitch != null) state.pitch = Math.max(0.05, Math.min(1.25, pitch));
        if (dist != null) state.dist = Math.max(4.5, Math.min(12, dist));
      },
      get view() { return { pitch: state.pitch, dist: state.dist }; },
      onFrame(cb) { state.frameCbs.push(cb); },
      /** ワールド座標 → CSS ピクセル。depth は視点からの距離。 */
      project(x, y, z) {
        const m = state.vp;
        if (!m) return null;
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0) return null;
        const dx = x - state.cam[0], dy = y - state.cam[1], dz = z - state.cam[2];
        return { x: (cx / cw * 0.5 + 0.5) * state.w, y: (1 - (cy / cw * 0.5 + 0.5)) * state.h, depth: Math.hypot(dx, dy, dz) };
      },
    };
    return api;
  }

  /** WebGL が使えない端末向け: CSS で描いた静的な宝石。カード配置用の投影は同じ数式で返す。 */
  function fallback(canvas, state) {
    const host = canvas.parentElement;
    canvas.hidden = true;
    const gem = document.createElement('div');
    gem.setAttribute('aria-hidden', 'true');
    gem.style.cssText = 'position:absolute;left:50%;top:50%;width:120px;height:120px;transform:translate(-50%,-55%) rotate(45deg);'
      + 'background:conic-gradient(from 20deg,#0b1f5c,#2563eb,#93c5fd,#1e3a8a,#3b82f6,#0b1f5c);border-radius:14px;'
      + 'box-shadow:0 0 60px rgba(37,99,235,.55);';
    host.appendChild(gem);
    const cbs = [];
    let running = false;
    const tick = (now) => { if (!running) return; cbs.forEach((cb) => cb(api, now / 1000)); requestAnimationFrame(tick); };
    const api = {
      webgl: false,
      start() { if (!running) { running = true; requestAnimationFrame(tick); } },
      stop() { running = false; },
      pulse() { gem.animate([{ boxShadow: '0 0 120px rgba(96,165,250,.95)' }, { boxShadow: '0 0 60px rgba(37,99,235,.55)' }], 600); },
      setView({ pitch, dist }) { if (pitch != null) state.pitch = Math.max(0.05, Math.min(1.25, pitch)); if (dist != null) state.dist = Math.max(4.5, Math.min(12, dist)); },
      get view() { return { pitch: state.pitch, dist: state.dist }; },
      onFrame(cb) { cbs.push(cb); },
      project(x, y, z) {
        const w = host.clientWidth, h = host.clientHeight;
        const camY = Math.sin(state.pitch) * state.dist, camZ = Math.cos(state.pitch) * state.dist;
        const depth = Math.hypot(x, y - camY, z - camZ);
        const s = Math.min(w, h) * 0.9 / depth;
        return { x: w / 2 + x * s * 1.3, y: h / 2 + (z * Math.sin(state.pitch) - y) * s, depth };
      },
    };
    return api;
  }

  ORBIT.Sapphire = { create };
})();
