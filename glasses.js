// TCM Cordovan — parametric frame model. Units: millimetres.
// Axes: +x = wearer's left on screen-right when facing camera, +y up, +z toward viewer.
// Front face of the frame sits at z = 0; temples run back along -z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SPEC = {
  lensW: 50, lensH: 33, bridge: 20, temple: 146,
  rimX: 4.5, rimY: 3.9, frontDepth: 5, bevel: 0.8,
};

// Super-ellipse with a different exponent per quadrant (out/in, top/bottom).
// xl > 0 points outward (toward the temple).
function lensOutline(a, b, cx, side, n = { ot: 2.9, it: 2.55, ib: 2.0, ob: 2.3 }, segs = 96) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const e = c >= 0 ? (s >= 0 ? n.ot : n.ob) : (s >= 0 ? n.it : n.ib);
    const xl = a * Math.sign(c) * Math.abs(c) ** (2 / e);
    const yl = b * Math.sign(s) * Math.abs(s) ** (2 / e);
    pts.push(new THREE.Vector2(side * (cx + xl), yl));
  }
  return pts;
}

function tortoiseTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4e1610'; g.fillRect(0, 0, S, S);
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const blob = (col, n, rmin, rmax) => {
    for (let i = 0; i < n; i++) {
      const x = r() * S, y = r() * S, rad = rmin + r() * (rmax - rmin);
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.save(); g.translate(x + dx, y + dy); g.scale(1.9, 0.8); g.translate(-(x + dx), -(y + dy));
        g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill(); g.restore();
      }
    }
  };
  blob('rgba(120,40,22,0.35)', 46, 30, 90);
  blob('rgba(160,70,30,0.16)', 26, 12, 40);
  blob('rgba(30,6,4,0.32)', 40, 10, 45);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 60, 1 / 60);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function logoTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 62px "Times New Roman", Georgia, serif';
  g.fillText('TCM', 128, 44);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const extrude = (shape, depth, bevel = SPEC.bevel) => {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9,
    bevelSegments: 4, curveSegments: 48,
  });
  geo.translate(0, 0, -(depth + bevel)); // front face at z = 0
  return geo;
};

const CURVE = 0.00095; // front base curve: z drops ~4 mm at the outer edge
function bend(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, pos.getZ(i) - CURVE * x * x); }
  pos.needsUpdate = true; geo.computeVertexNormals(); return geo;
}

function roundedRect(x0, y0, x1, y1, r) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1); s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

export function buildMaterials() {
  return {
    acetate: new THREE.MeshPhysicalMaterial({
      color: 0xf2e2da, map: tortoiseTexture(), roughness: 0.3, metalness: 0,
      clearcoat: 0.8, clearcoatRoughness: 0.1,
    }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x6e5244, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6,
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0xe6e6e6, metalness: 1, roughness: 0.18 }),
    logo: new THREE.MeshStandardMaterial({
      map: logoTexture(), transparent: true, roughness: 0.4, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2,
    }),
  };
}

// One side (screen-right): rim, lens, lug, pins, temple.
function buildHalf(m) {
  const { lensW, lensH, bridge, rimX, rimY, frontDepth, temple } = SPEC;
  const a = lensW / 2, b = lensH / 2, cx = bridge / 2 + a;
  const half = new THREE.Group();

  const outer = new THREE.Shape(lensOutline(a + rimX, b + rimY, cx, 1,
    { ot: 2.8, it: 2.5, ib: 2.05, ob: 2.3 }));
  outer.holes.push(new THREE.Path(lensOutline(a, b, cx, 1)));
  const rim = new THREE.Mesh(bend(extrude(outer, frontDepth)), m.acetate);
  half.add(rim);

  const lens = new THREE.Mesh(bend(new THREE.ShapeGeometry(new THREE.Shape(lensOutline(a + 0.6, b + 0.6, cx, 1)), 48)), m.lens);
  lens.position.z = -3.2; lens.renderOrder = 3;
  half.add(lens);

  const outerX = cx + a + rimX; // ≈ 65.2
  const lug = new THREE.Mesh(bend(extrude(roundedRect(outerX - 6.5, 4.2, outerX + 3.6, 16.2, 2.6), 9)), m.acetate);
  half.add(lug);
  for (const dx of [-1.6, 1.3]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.8, 20).rotateX(Math.PI / 2), m.metal);
    pin.position.set(outerX + dx, 11.4, 0.15 - CURVE * (outerX + dx) ** 2);
    half.add(pin);
  }

  // Temple: side profile (u along length, v vertical), extruded through its thickness.
  const p = new THREE.Shape();
  p.moveTo(0, 3.3);
  p.lineTo(temple - 36, 2.6);
  p.quadraticCurveTo(temple - 26, 2.3, temple - 20, -1.2);
  p.lineTo(temple - 2.5, -9.2);
  p.quadraticCurveTo(temple + 0.8, -10.8, temple - 1.2, -13.2);
  p.quadraticCurveTo(temple - 3, -14.2, temple - 5.4, -12.6);
  p.lineTo(temple - 22, -5.2);
  p.quadraticCurveTo(temple - 28, -2.6, temple - 37, -2.4);
  p.lineTo(0, -3.3);
  p.closePath();
  const tGeo = new THREE.ExtrudeGeometry(p, {
    depth: 3.6, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.55, bevelSegments: 3, curveSegments: 24,
  });
  tGeo.translate(0, 0, 0.6);           // thickness 0..4.8
  tGeo.rotateY(Math.PI / 2);           // length → -z, thickness → +x
  const pivot = new THREE.Group();
  pivot.position.set(outerX - 0.4, 10.2, -4 - CURVE * outerX * outerX);
  pivot.rotation.y = -THREE.MathUtils.degToRad(4); // slight outward splay
  pivot.add(new THREE.Mesh(tGeo, m.acetate));
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 3.3).rotateY(Math.PI / 2), m.logo);
  logo.name = 'logo';
  logo.position.set(4.86, 0.1, -22);
  pivot.add(logo);
  half.add(pivot);

  return half;
}

export function buildGlasses() {
  const m = buildMaterials();
  const root = new THREE.Group();
  root.name = 'TCM Cordovan';

  const right = buildHalf(m);
  const left = new THREE.Group();
  left.scale.x = -1;
  const mirrored = right.clone(true);
  mirrored.traverse(o => { if (o.name === 'logo') o.scale.x = -1; });
  left.add(mirrored);
  root.add(right, left);

  // Bridge: flat top, arched underside (keyhole).
  const bw = SPEC.bridge / 2 + 1.2;
  const br = new THREE.Shape();
  br.moveTo(-bw, 8.5);
  br.quadraticCurveTo(0, 14.2, bw, 8.5);
  br.lineTo(bw, 18.2);
  br.quadraticCurveTo(0, 17.4, -bw, 18.2);
  br.closePath();
  root.add(new THREE.Mesh(bend(extrude(br, SPEC.frontDepth)), m.acetate));

  root.userData.materials = m;
  return root;
}

// Invisible head volume so temples disappear behind the head/ears.
export function buildOccluder() {
  // Head slightly narrower than the temples (so the near temple stays visible when turning),
  // plus ears that swallow the temple tips.
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const g = new THREE.Group();
  const part = (rx, ry, rz, x, y, z) => {
    const geo = new THREE.SphereGeometry(1, 40, 28); geo.scale(rx, ry, rz); geo.translate(x, y, z);
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = -1; g.add(mesh);
  };
  part(68, 108, 100, 0, -15, -102);
  part(19, 34, 44, 70, -6, -122);
  part(19, 34, 44, -70, -6, -122);
  return g;
}

// Soft studio lighting for reflections: grey gradient dome + one gentle softbox above-front.
export function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {},
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 p; void main(){ float t = clamp(p.y*0.5+0.5,0.0,1.0); vec3 c = mix(vec3(0.32,0.30,0.29), vec3(1.35,1.32,1.28), smoothstep(0.2,0.9,t)); gl_FragColor = vec4(c,1.0); }',
  }));
  env.add(dome);
  const box = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 2.95, 2.85), side: THREE.DoubleSide }));
  box.position.set(0, 60, 60); box.lookAt(0, 0, 0); env.add(box);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02).texture; pm.dispose();
  return tex;
}

// AI-generated Cordovan (Meshy), cleaned offline: millimetres, front face z = 0, lens centre y = 0,
// lenses split into their own primitive. Falls back to the coded frame if it fails to load.
export async function loadGlasses(src = './cordovan.glb') {
  try {
    const loader = new GLTFLoader();
    const gltf = typeof src === 'string' ? await loader.loadAsync(src) : await loader.parseAsync(src, '');
    const root = gltf.scene; root.name = 'TCM Cordovan';
    root.traverse(o => {
      if (!o.isMesh) return;
      const old = o.material;
      if (old.name === 'Lens') {
        o.material = new THREE.MeshPhysicalMaterial({
          color: 0x6e5244, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5,
          depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.9,
        });
        o.renderOrder = 3;
      } else {
        o.material = new THREE.MeshPhysicalMaterial({
          map: old.map, normalMap: old.normalMap, roughnessMap: old.roughnessMap, metalnessMap: old.metalnessMap,
          roughness: 0.85, metalness: 1, clearcoat: 0.55, clearcoatRoughness: 0.12, side: THREE.DoubleSide,
        });
      }
    });
    return root;
  } catch (e) {
    console.warn('GLB failed, using coded frame', e);
    return buildGlasses();
  }
}
