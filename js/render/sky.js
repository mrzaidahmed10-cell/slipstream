// Procedural sky dome: gradient, sun/moon, fbm clouds, stars, aurora.
import { THREE } from './gfx.js';

const vert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop, uMid, uHorizon, uGround, uSunDir, uSunColor, uMoonDir;
uniform float uTime, uCloud, uStars, uAurora, uSunSize, uMoon, uHaze;
uniform vec3 uCloudLit, uCloudDark;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += noise(p)*a; p = p*2.03 + 7.1; a *= 0.5; }
  return s;
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0){
    float t = pow(clamp(h, 0.0, 1.0), 0.45);
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.35, t));
    col = mix(col, uTop, smoothstep(0.3, 1.0, t));
  } else {
    col = mix(uHorizon, uGround, smoothstep(0.0, 0.25, -h));
  }
  // atmospheric haze toward the horizon
  col = mix(col, uHorizon, uHaze * exp(-abs(h) * 6.0));

  // stars
  if (uStars > 0.0 && h > 0.0){
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 fp = fract(sp) - 0.5;
    float star = smoothstep(0.985, 1.0, r) * smoothstep(0.35, 0.0, length(fp));
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + r * 60.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * uStars * smoothstep(0.02, 0.35, h);
  }
  // aurora
  if (uAurora > 0.0 && h > 0.05){
    vec2 uv = d.xz / (h + 0.35);
    float band = fbm(vec2(uv.x * 1.3 + uTime * 0.03, uv.y * 0.8 - uTime * 0.02));
    float curtain = smoothstep(0.42, 0.62, band) * smoothstep(0.08, 0.3, h) * (1.0 - smoothstep(0.55, 0.9, h));
    float streak = 0.6 + 0.4 * sin(uv.x * 14.0 + band * 9.0 + uTime * 0.7);
    vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.55, 0.3, 1.0), smoothstep(0.25, 0.7, h));
    col += ac * curtain * streak * uAurora;
  }
  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  float disc = smoothstep(uSunSize, uSunSize * 0.82, 1.0 - sd);
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.55 + pow(sd, 6.0) * 0.18);
  col = mix(col, uSunColor * 2.6, disc * step(0.0, uSunSize));
  // moon
  if (uMoon > 0.0){
    float md = dot(d, uMoonDir);
    float moon = smoothstep(0.9993, 0.9996, md);
    col += vec3(0.9, 0.95, 1.0) * moon * uMoon + vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 80.0) * 0.35 * uMoon;
  }
  // clouds
  if (uCloud > 0.0 && h > 0.0){
    vec2 uv = d.xz / (h + 0.22) * 0.55 + vec2(uTime * 0.012, uTime * 0.004);
    float c = fbm(uv * 1.7);
    float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.28, c);
    float c2 = fbm(uv * 1.7 + uSunDir.xz * 0.12);
    float lit = clamp(0.55 + (c - c2) * 3.2, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc += uSunColor * pow(sd, 8.0) * 0.45;
    cov *= smoothstep(0.0, 0.14, h);
    col = mix(col, cc, cov * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export const SKY_THEMES = {
  stadium: { top: '#142a63', mid: '#4a63a8', horizon: '#ffb07a', ground: '#2a2f45', sunDir: [0.55, 0.16, 0.6], sunColor: '#ffb27a', cloud: 0.3, cloudLit: '#ffd7b8', cloudDark: '#5a5f95', stars: 0.5, aurora: 0, sunSize: 0.00022, moon: 0, haze: 0.45 },
  desert: { top: '#2f78d6', mid: '#7fb8ee', horizon: '#ffe6bf', ground: '#d9b074', sunDir: [0.35, 0.78, 0.5], sunColor: '#fff0cf', cloud: 0.2, cloudLit: '#ffffff', cloudDark: '#b9c8de', stars: 0, aurora: 0, sunSize: 0.0004, moon: 0, haze: 0.6 },
  winter: { top: '#0f2766', mid: '#3b64b3', horizon: '#ffcaa6', ground: '#c8d8f0', sunDir: [-0.6, 0.12, 0.55], sunColor: '#ffd0a0', cloud: 0.34, cloudLit: '#ffe3d1', cloudDark: '#56679a', stars: 0.55, aurora: 0.55, sunSize: 0.0003, moon: 0, haze: 0.5 },
  beach: { top: '#2a74d4', mid: '#74b6f0', horizon: '#ffd7a8', ground: '#2e8fb0', sunDir: [-0.65, 0.3, 0.55], sunColor: '#ffc78a', cloud: 0.3, cloudLit: '#fff1e0', cloudDark: '#9fb4d6', stars: 0, aurora: 0, sunSize: 0.0006, moon: 0, haze: 0.55 },
  forest: { top: '#6fa3c4', mid: '#a9cfd0', horizon: '#eef4de', ground: '#4a5f43', sunDir: [0.4, 0.5, 0.7], sunColor: '#fff2c8', cloud: 0.42, cloudLit: '#ffffff', cloudDark: '#b4c6cc', stars: 0, aurora: 0, sunSize: 0.0003, moon: 0, haze: 0.75 },
  city: { top: '#03061a', mid: '#141238', horizon: '#6b2a78', ground: '#0b0b1c', sunDir: [0, -0.5, 1], sunColor: '#000000', cloud: 0.25, cloudLit: '#6a4c9a', cloudDark: '#1a1636', stars: 0.9, aurora: 0, sunSize: 0, moon: 1, moonDir: [-0.45, 0.5, 0.74], haze: 0.7 },
};

export function createSky(theme) {
  const T = SKY_THEMES[theme] || SKY_THEMES.desert;
  const v3 = (a) => new THREE.Vector3(...a).normalize();
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(T.top) }, uMid: { value: new THREE.Color(T.mid) }, uHorizon: { value: new THREE.Color(T.horizon) }, uGround: { value: new THREE.Color(T.ground) },
      uSunDir: { value: v3(T.sunDir) }, uSunColor: { value: new THREE.Color(T.sunColor) }, uMoonDir: { value: v3(T.moonDir || [0, 1, 0]) },
      uTime: { value: 0 }, uCloud: { value: T.cloud }, uStars: { value: T.stars }, uAurora: { value: T.aurora }, uSunSize: { value: T.sunSize }, uMoon: { value: T.moon }, uHaze: { value: T.haze },
      uCloudLit: { value: new THREE.Color(T.cloudLit) }, uCloudDark: { value: new THREE.Color(T.cloudDark) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  mesh.scale.setScalar(1500);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh, params: T,
    sunDir: v3(T.sunDir),
    update(camPos, t) { mesh.position.copy(camPos); mat.uniforms.uTime.value = t; },
  };
}
