/**
 * globe.js — Interactive photorealistic 3D Earth for the Daylight app.
 *
 * ES module (no build step): THREE is imported from the local vendored
 * three.module.min.js via the import map in globe.html; SolarMath and
 * GlobeMath are classic-script globals loaded before this module.
 *
 * ── Coordinate convention (see globe-math.js for the full derivation) ─────
 *
 *   +Y = north pole, +X = (0°, 0°), +Z = (0°, −90°), −Z = (0°, +90°)
 *   x = cos(lat)·cos(lng), y = sin(lat), z = −cos(lat)·sin(lng)
 *
 * The Earth mesh is NEVER rotated: the scene keeps the globe fixed in object
 * space (which equals world space — the mesh's model matrix is identity) and
 * the camera orbits it. The Sun's world-space direction is recomputed from
 * SolarMath each second and uploaded as a uniform, so the continent-to-
 * sunlight relationship is exact at every frame — camera motion and any
 * presentation auto-rotation can never move the terminator relative to the
 * continents.
 *
 * The day/night terminator is computed per-fragment in the shader as
 * sin(altitude) = dot(surfaceNormal, uSunDir), using the exact twilight
 * thresholds from SolarMath.TWILIGHT_THRESHOLDS (daylight = −0.833° including
 * the app's refraction convention, civil −6°, nautical −12°, astronomical
 * −18°). Direct sunlight ramps to zero exactly at the daylight threshold, so
 * the visible day/night boundary follows the documented apparent-horizon
 * convention; the bluish tint below it is atmospheric (scattered) light and
 * never brightens the surface at or below the boundary. The same quantity
 * drives SolarMath.getSolarSinAltitude() on the 2D map, so both views agree
 * exactly. Smooth transitions are symmetric around each threshold and
 * therefore never move a geographic boundary.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(function () {
  'use strict';

  const SM = window.SolarMath;
  const GM = window.GlobeMath;
  const GC = window.GlobeClouds;
  const DF = window.DaylightFormat;

  // ── Constants ─────────────────────────────────────────────────────────
  const ASSET_VERSION = '20260804a';
  const TEXTURE_URLS = {
    day: `assets/globe/day.jpg?v=${ASSET_VERSION}`,
    night: `assets/globe/night.png?v=${ASSET_VERSION}`,
    bump: `assets/globe/bump.jpg?v=${ASSET_VERSION}`,
    specular: `assets/globe/specular.jpg?v=${ASSET_VERSION}`,
    clouds: `assets/globe/clouds.png?v=${ASSET_VERSION}`
  };
  const EARTH_RADIUS = 1;
  const CLOUD_RADIUS = 1.008;
  const ATMOSPHERE_RADIUS = 1.025;
  const STAR_RADIUS = 220;
  const MIN_CAMERA_DISTANCE = 1.32;
  const MAX_CAMERA_DISTANCE = 7;
  const SOLAR_UPDATE_MS = 1000;
  const MAX_PIXEL_RATIO = 2;
  // Smoothing half-width in sin(altitude) units (~0.7°). Applied symmetrically
  // around every threshold so band positions remain exact.
  const BAND_SMOOTHNESS = 0.012;
  // City lights fade in across ~±3.5° of solar altitude around the
  // astronomical twilight threshold.
  const NIGHT_FADE_HALF_WIDTH = 0.061;
  // Default atmosphere fill: the outer atmospheric edge should occupy this
  // fraction of the viewport's binding (smaller) dimension. 0.93 leaves ~7%
  // breathing room, inside the 5–10% UI-02 target. Responsive framing below
  // clamps the resulting distance to the existing min/max range, so very
  // narrow viewports get a wider margin rather than clipping.
  const DEFAULT_ATMOSPHERE_FILL = 0.93;
  // Original default camera position preserved as a directional reference so
  // Reset Camera and the resize handler keep the same elevation/azimuth as
  // the historical load.
  const DEFAULT_CAMERA_Y = 0.7;
  const DEFAULT_CAMERA_Z = 2.55;
  const DEFAULT_CAMERA_DISTANCE = Math.hypot(DEFAULT_CAMERA_Y, DEFAULT_CAMERA_Z);

  const els = {
    canvas: document.getElementById('globe-canvas'),
    loading: document.getElementById('globe-loading'),
    error: document.getElementById('globe-error'),
    errorTitle: document.getElementById('globe-error-title'),
    errorDetail: document.getElementById('globe-error-detail'),
    retry: document.getElementById('globe-retry-btn'),
    utcTime: document.getElementById('utc-time'),
    sunPosition: document.getElementById('sun-position'),
    liveStatus: document.getElementById('live-status'),
    liveBadge: document.getElementById('live-badge'),
    toggleClouds: document.getElementById('toggle-clouds'),
    toggleAtmosphere: document.getElementById('toggle-atmosphere'),
    resetCamera: document.getElementById('reset-camera-btn')
  };

  // ── Failure state (visible, non-blocking, with retry + 2D map link) ───
  function showFailure(title, detail) {
    els.errorTitle.textContent = title;
    els.errorDetail.textContent = detail;
    els.error.hidden = false;
    els.loading.hidden = true;
    els.liveBadge.hidden = true;
    // X-04: a failed globe must never leave a dead canvas in the tab order,
    // and focus must not be stranded on the non-functional surface.
    els.canvas.tabIndex = '-1';
    if (document.activeElement === els.canvas) {
      els.retry.focus();
    }
  }

  els.retry.addEventListener('click', () => window.location.reload());

  // ── Dependency and WebGL checks ───────────────────────────────────────
  // (Three.js load failure is caught by the watchdog in globe.html, because
  // a failed module import prevents this script from running at all.)
  if (!SM || !GM || !GC || !DF) {
    showFailure(
      'The 3D globe could not be started.',
      'A required script (solar.js, globe-math.js, globe-clouds.js, or format.js) did not load. Check the browser console, then try again.'
    );
    return;
  }

  let glTest = null;
  try {
    glTest = document.createElement('canvas').getContext('webgl2', { antialias: true });
  } catch (e) {
    glTest = null;
  }
  if (!glTest) {
    showFailure(
      'WebGL is not available in this browser.',
      'The globe needs WebGL 2 to render. Try updating your browser or enabling hardware acceleration, then reload. The 2D map still works without WebGL.'
    );
    return;
  }

  // ── Time state ────────────────────────────────────────────────────────
  // Live mode by default. ?time=ISO overrides the instant (used for
  // deterministic verification and permalinks, matching the 2D page).
  const state = { date: new Date(), live: true };
  const parsedTimeParam = SM.parsePermalinkParams(window.location.search).time;
  if (parsedTimeParam) {
    state.date = parsedTimeParam;
    state.live = false;
    els.liveStatus.textContent = 'Paused';
  }

  function setDate(date) {
    state.date = date;
    state.live = false;
    els.liveStatus.textContent = 'Paused';
    updateSolar(date);
    updatePanel(date);
  }

  // ── Renderer / scene / camera ─────────────────────────────────────────
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    showFailure('WebGL could not be initialised.', String(e));
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Tone mapping and sRGB encoding are performed inside the custom shaders,
  // so the renderer does no additional color conversion.
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 600);

  // ── Default camera framing (UI-02) ───────────────────────────────────
  // The fresh-load camera distance is derived from the camera's FOV, the
  // current aspect ratio, and the atmosphere radius so the full atmosphere
  // fits inside the visible canvas with ~7% breathing room regardless of
  // viewport. The result is clamped to the existing [MIN, MAX] range so the
  // user-facing zoom limits are unchanged; very narrow viewports simply get
  // a wider margin instead of clipping. The directional elevation of the
  // original default is preserved so Reset Camera and the initial framing
  // share the same look-at angle.
  function defaultCameraDistance(cam, atmosphereRadius) {
    const fovRad = cam.fov * Math.PI / 180;
    const tanV = Math.tan(fovRad / 2);
    const tanH = tanV * cam.aspect;
    const tanBinding = Math.min(tanV, tanH);
    // asin(atmosphereRadius / d) = DEFAULT_ATMOSPHERE_FILL * atan(tanBinding)
    // → d = atmosphereRadius / sin(DEFAULT_ATMOSPHERE_FILL * atan(tanBinding))
    const bindingAngle = Math.atan(tanBinding);
    return atmosphereRadius / Math.sin(DEFAULT_ATMOSPHERE_FILL * bindingAngle);
  }

  function clampCameraDistance(d) {
    return Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, d));
  }

  function applyDefaultCameraPosition(cam, distance) {
    const d = clampCameraDistance(distance);
    const scale = d / DEFAULT_CAMERA_DISTANCE;
    cam.position.set(0, DEFAULT_CAMERA_Y * scale, DEFAULT_CAMERA_Z * scale);
  }

  applyDefaultCameraPosition(camera, defaultCameraDistance(camera, ATMOSPHERE_RADIUS));

  const controls = new OrbitControls(camera, els.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.autoRotate = true;
  // UI-02: ambient planetary motion, ~150 s per full revolution. Paired
  // with the deltaTime-aware controls.update(dt) call in render() below so
  // the rate is frame-rate independent.
  controls.autoRotateSpeed = 0.4;

  // ── Bounded keyboard orbit/zoom (X-04) ────────────────────────────────
  // The canvas is keyboard-focusable only after initialization (tabindex is
  // promoted in onAllTexturesLoaded and reset on failure). Arrow keys apply
  // a fixed 15° rotation step and +/- a fixed ~15% zoom step per keypress,
  // mirroring drag-to-orbit and wheel-to-zoom. Steps are deterministic and
  // independent of frame rate; the camera is written in spherical
  // coordinates around the OrbitControls target and applied through
  // controls.update(), so the existing distance bounds and damping stay
  // consistent. Only handled keys prevent default — nothing global.
  const KEYBOARD_ROTATE_STEP = Math.PI / 12; // 15° per press
  const KEYBOARD_ZOOM_FACTOR = 0.85;

  function keyboardRotate(deltaAzimuth, deltaPolar) {
    const offset = camera.position.clone().sub(controls.target);
    const radius = offset.length();
    const phi = Math.min(Math.PI, Math.max(0, Math.acos(Math.min(1, Math.max(-1, offset.y / radius))) - deltaPolar));
    const theta = Math.atan2(offset.x, offset.z) - deltaAzimuth;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    ).add(controls.target);
    controls.update();
  }

  function keyboardZoom(direction) {
    const offset = camera.position.clone().sub(controls.target);
    const radius = Math.min(MAX_CAMERA_DISTANCE, Math.max(MIN_CAMERA_DISTANCE, offset.length() * Math.pow(KEYBOARD_ZOOM_FACTOR, direction)));
    camera.position.copy(offset.normalize().multiplyScalar(radius).add(controls.target));
    controls.update();
  }

  // Arrow keys follow the drag direction: ArrowLeft/ArrowUp move the view
  // the same way dragging the globe left/up does. First keyboard use stops
  // presentation auto-rotation, matching the existing first-interaction rule.
  els.canvas.addEventListener('keydown', function (e) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        controls.autoRotate = false;
        keyboardRotate(-KEYBOARD_ROTATE_STEP, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        controls.autoRotate = false;
        keyboardRotate(KEYBOARD_ROTATE_STEP, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        controls.autoRotate = false;
        keyboardRotate(0, -KEYBOARD_ROTATE_STEP);
        break;
      case 'ArrowDown':
        e.preventDefault();
        controls.autoRotate = false;
        keyboardRotate(0, KEYBOARD_ROTATE_STEP);
        break;
      case '+':
      case '=':
        e.preventDefault();
        controls.autoRotate = false;
        userAdjustedDistance = true;
        keyboardZoom(1);
        break;
      case '-':
        e.preventDefault();
        controls.autoRotate = false;
        userAdjustedDistance = true;
        keyboardZoom(-1);
        break;
    }
  });
  controls.update();

  // Stop presentation auto-rotation on first user interaction, and respect
  // reduced-motion preferences.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) controls.autoRotate = false;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // ── Shared solar uniforms ─────────────────────────────────────────────
  // One persistent vector, updated per second from SolarMath — no per-frame
  // allocation, no per-frame astronomy.
  const sunDirVector = new THREE.Vector3();
  const thresholdVec = new THREE.Vector4(
    SM.TWILIGHT_THRESHOLDS.daylight, // x: daylight  (sin(−0.833°))
    SM.TWILIGHT_THRESHOLDS.civil,    // y: civil
    SM.TWILIGHT_THRESHOLDS.nautical, // z: nautical
    SM.TWILIGHT_THRESHOLDS.astronomical // w: astronomical
  );
  const SUN_COLOR = new THREE.Color(1.0, 0.98, 0.92);

  const sharedUniforms = {
    uSunDir: { value: sunDirVector },
    uSunColor: { value: SUN_COLOR },
    uThresholds: { value: thresholdVec }
  };

  function updateSolar(date) {
    const sun = SM.getSunRenderState(date);
    GM.geoToVector3(sun.lat, sun.lng, sunDirVector);
  }

  // ── Textures ──────────────────────────────────────────────────────────
  const loader = new THREE.TextureLoader();
  let texturesPending = 0;
  let textureLoadFailed = false;
  const textures = {};

  function loadTexture(key, url, colorSpace) {
    texturesPending += 1;
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = colorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        // The cloud shader samples longitude at uv.x + uDrift, which grows
        // past one texture width as the page runs. Without horizontal repeat
        // wrapping, ClampToEdge clamps an ever-wider longitude band to the
        // texture's right-edge column (D-01); RepeatWrapping keeps sampling
        // periodic across the antimeridian.
        if (key === 'clouds') GC.configureCloudTexture(texture, THREE.RepeatWrapping);
        textures[key] = texture;
        texturesPending -= 1;
        if (texturesPending === 0 && !textureLoadFailed) onAllTexturesLoaded();
      },
      undefined,
      () => {
        texturesPending -= 1;
        if (textureLoadFailed) return;
        textureLoadFailed = true;
        showFailure(
          'A required globe texture failed to load.',
          `${url} could not be loaded (see browser console). Check the deployment, then try again.`
        );
      }
    );
  }

  loadTexture('day', TEXTURE_URLS.day, THREE.SRGBColorSpace);
  loadTexture('night', TEXTURE_URLS.night, THREE.SRGBColorSpace);
  loadTexture('bump', TEXTURE_URLS.bump, THREE.NoColorSpace);
  loadTexture('specular', TEXTURE_URLS.specular, THREE.NoColorSpace);
  loadTexture('clouds', TEXTURE_URLS.clouds, THREE.NoColorSpace);

  let started = false;

  // ── Shaders ───────────────────────────────────────────────────────────
  // Tone mapping (ACES fitted curve) and the sRGB transfer function are
  // implemented inline so the rendering pipeline is self-contained and does
  // not depend on three.js-injected tone-mapping uniforms. Textures tagged
  // SRGBColorSpace are uploaded as sRGB textures, so sampling returns linear
  // values; the final encode happens here.
  const TONEMAP_CHUNK = `
    vec3 acesFilmic(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    vec3 linearToSrgb(vec3 c) {
      c = max(c, vec3(0.0));
      return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }
  `;
  const OUTPUT_CHUNK = `
    finalColor = acesFilmic(finalColor * uExposure);
    finalColor = linearToSrgb(finalColor);
  `;

  // Declarations for the uniforms shared by all three globe shaders.
  const SHARED_UNIFORM_DECLARATIONS = `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec4 uThresholds;
  `;

  // Light state shared by the earth, cloud, and atmosphere fragment shaders.
  // The band weights partition the sin(altitude) axis exactly at the four
  // SolarMath thresholds; smoothstep widths are symmetric, so boundaries stay
  // put. Written as a function (not globals): GLSL ES 1.00 forbids non-constant
  // global initializers, and uniforms/varyings are legal inside functions.
  const LIGHT_STATE_CHUNK = `
    void computeLightState(
      out float sinAlt,
      out float sunIntensity,
      out float dayBand,
      out float civilBand,
      out float nautBand,
      out float astroBand,
      out float twilightDepth,
      out float nightFade
    ) {
      sinAlt = clamp(dot(normalize(vNormal), uSunDir), -1.0, 1.0);
      float h = uBandSmoothness;
      dayBand = smoothstep(uThresholds.x - h, uThresholds.x + h, sinAlt);
      civilBand = smoothstep(uThresholds.y - h, uThresholds.y + h, sinAlt);
      nautBand = smoothstep(uThresholds.z - h, uThresholds.z + h, sinAlt);
      astroBand = smoothstep(uThresholds.w - h, uThresholds.w + h, sinAlt);
      // Direct sunlight intensity shares the dayBand ramp, so the visible
      // day/night boundary sits exactly on the daylight threshold (sin
      // −0.833°, the documented apparent-horizon convention) and there is no
      // direct light at or below it; atmospheric twilight is separate below.
      sunIntensity = dayBand;
      // twilightDepth: approximately 0 at or above the daylight boundary,
      // rising continuously to approximately 1 at or below the astronomical
      // threshold. uThresholds is ordered x (daylight) > w (astronomical), so
      // the smoothstep edges are reversed and the result inverted — GLSL
      // smoothstep is undefined when edge0 >= edge1.
      twilightDepth = 1.0 - smoothstep(uThresholds.w, uThresholds.x, sinAlt);
      nightFade = 1.0 - smoothstep(
        uThresholds.w - uNightFadeHalfWidth,
        uThresholds.w + uNightFadeHalfWidth,
        sinAlt
      );
    }
  `;

  // ── Earth ─────────────────────────────────────────────────────────────
  // All vectors here are in WORLD space: vNormal comes from the model matrix
  // (identity for this globe, but written generally), and uSunDir is the
  // world-space subsolar direction. The globe itself never rotates.
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uDayTex: { value: null },
      uNightTex: { value: null },
      uBumpTex: { value: null },
      uSpecTex: { value: null },
      uCamPos: { value: new THREE.Vector3() },
      uExposure: { value: 1.15 },
      uBandSmoothness: { value: BAND_SMOOTHNESS },
      uNightFadeHalfWidth: { value: NIGHT_FADE_HALF_WIDTH }
    }, sharedUniforms),
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uDayTex;
      uniform sampler2D uNightTex;
      uniform sampler2D uBumpTex;
      uniform sampler2D uSpecTex;
      uniform vec3 uCamPos;
      uniform float uExposure;
      uniform float uBandSmoothness;
      uniform float uNightFadeHalfWidth;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      ${SHARED_UNIFORM_DECLARATIONS}
      ${TONEMAP_CHUNK}
      ${LIGHT_STATE_CHUNK}

      float bumpLuminance(vec2 uv) {
        vec4 s = texture2D(uBumpTex, uv);
        return dot(s.rgb, vec3(0.25, 0.5, 0.25));
      }

      void main() {
        float sinAlt;
        float sunIntensity;
        float dayBand;
        float civilBand;
        float nautBand;
        float astroBand;
        float twilightDepth;
        float nightFade;
        computeLightState(sinAlt, sunIntensity, dayBand, civilBand, nautBand, astroBand, twilightDepth, nightFade);

        // Terrain detail via the shaded-relief bump map. A spherical tangent
        // frame is built from the world-space normal (guarded at the poles)
        // and the bump gradient perturbs it slightly. The surface geometry
        // stays a perfect unit sphere, so geographic correctness is untouched.
        vec2 bumpUv = vUv;
        float b0 = bumpLuminance(bumpUv);
        float bx = bumpLuminance(bumpUv + vec2(1.0 / 2048.0, 0.0));
        float by = bumpLuminance(bumpUv + vec2(0.0, 1.0 / 1024.0));
        vec3 tangent = normalize(cross(vNormal, vec3(0.0, 1.0, 0.0)));
        if (length(tangent) < 0.001) tangent = vec3(1.0, 0.0, 0.0);
        vec3 bitangent = cross(vNormal, tangent);
        vec3 n = normalize(vNormal + (tangent * (bx - b0) + bitangent * (by - b0)) * 0.55);

        vec3 dayTex = texture2D(uDayTex, vUv).rgb;
        vec3 nightTex = texture2D(uNightTex, vUv).rgb;
        float specMask = texture2D(uSpecTex, vUv).g;

        // Sunlit day surface: direct light ramps to zero exactly at the
        // −0.833° daylight boundary (the app's apparent-horizon convention),
        // matching the 2D map's daylight classification. There is no direct
        // light at or below the boundary; the twilight tint applied below is
        // atmospheric (scattered) light, so the night side never brightens.
        vec3 color = dayTex * uSunColor * sunIntensity * dayBand;

        // Atmospheric twilight tint between the daylight and astronomical
        // thresholds (blue-shifts and dims the terminator region).
        color *= mix(vec3(1.0), vec3(0.30, 0.36, 0.60), 0.55 * twilightDepth);

        // Ocean specular: sun glitter on the day side, gated by the water mask.
        vec3 viewDir = normalize(uCamPos - vWorldPos);
        vec3 halfDir = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, halfDir), 0.0), 128.0) * specMask * dayBand;
        color += spec * uSunColor * 0.9;

        // Night side: city lights fade in as the Sun drops below −18° and
        // become fully visible in deep night. Only the dark side shows them.
        color += nightTex * uSunColor * nightFade * 1.6;
        color += vec3(0.0012, 0.0024, 0.0080) * astroBand;

        vec3 finalColor = color;
        ${OUTPUT_CHUNK}
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `
  });

  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 128, 96), earthMaterial);
  earthMesh.renderOrder = 1;
  scene.add(earthMesh);

  // ── Clouds ────────────────────────────────────────────────────────────
  const cloudUniforms = Object.assign({
    uCloudTex: { value: null },
    uCamPos: { value: new THREE.Vector3() },
    uDrift: { value: 0 },
    uExposure: { value: 1.1 },
    uBandSmoothness: { value: BAND_SMOOTHNESS },
    uNightFadeHalfWidth: { value: NIGHT_FADE_HALF_WIDTH }
  }, sharedUniforms);

  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uCloudTex;
      uniform vec3 uCamPos;
      uniform float uDrift;
      uniform float uExposure;
      uniform float uBandSmoothness;
      uniform float uNightFadeHalfWidth;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      ${SHARED_UNIFORM_DECLARATIONS}
      ${TONEMAP_CHUNK}
      ${LIGHT_STATE_CHUNK}

      void main() {
        float sinAlt;
        float sunIntensity;
        float dayBand;
        float civilBand;
        float nautBand;
        float astroBand;
        float twilightDepth;
        float nightFade;
        computeLightState(sinAlt, sunIntensity, dayBand, civilBand, nautBand, astroBand, twilightDepth, nightFade);

        // Subtle longitude drift: clouds move relative to the fixed Sun
        // direction, which changes cloud shading but never geography.
        vec2 cloudUv = vec2(vUv.x + uDrift, vUv.y);
        vec4 cloudSample = texture2D(uCloudTex, cloudUv);
        float coverage = cloudSample.a;
        float brightness = cloudSample.r;

        vec3 dayCol = vec3(brightness) * uSunColor * sunIntensity * dayBand;
        // Warm terminator edge on the sun side of the civil band.
        dayCol += vec3(brightness) * vec3(1.0, 0.55, 0.25) * (1.0 - dayBand) * civilBand * 0.35;
        // Night-side clouds stay near-black: no uniform glow.
        dayCol += vec3(0.0015, 0.0030, 0.0090) * coverage * nightFade * 0.15;

        vec3 finalColor = dayCol;
        ${OUTPUT_CHUNK}
        gl_FragColor = vec4(finalColor, coverage * 0.85);
      }
    `
  });

  const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 96, 64), cloudMaterial);
  cloudMesh.renderOrder = 2;
  scene.add(cloudMesh);

  // ── Atmosphere ────────────────────────────────────────────────────────
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uExposure: { value: 1.0 },
      uBandSmoothness: { value: BAND_SMOOTHNESS },
      uNightFadeHalfWidth: { value: NIGHT_FADE_HALF_WIDTH },
      uStrength: { value: 0.5 }
    }, sharedUniforms),
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewNormal;

      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uExposure;
      uniform float uBandSmoothness;
      uniform float uNightFadeHalfWidth;
      uniform float uStrength;

      varying vec3 vNormal;
      varying vec3 vViewNormal;

      ${SHARED_UNIFORM_DECLARATIONS}
      ${TONEMAP_CHUNK}
      ${LIGHT_STATE_CHUNK}

      void main() {
        float sinAlt;
        float sunIntensity;
        float dayBand;
        float civilBand;
        float nautBand;
        float astroBand;
        float twilightDepth;
        float nightFade;
        computeLightState(sinAlt, sunIntensity, dayBand, civilBand, nautBand, astroBand, twilightDepth, nightFade);

        // Rim glow on the backside sphere: strongest at the silhouette,
        // brighter on the day side, faint on the night side.
        float rim = pow(1.0 - abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0))), 3.0);
        vec3 color = vec3(0.22, 0.42, 1.0) * rim * uStrength * (0.35 + 0.65 * dayBand);
        vec3 finalColor = color;
        ${OUTPUT_CHUNK}
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const atmosphereMesh = new THREE.Mesh(new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 64, 48), atmosphereMaterial);
  atmosphereMesh.renderOrder = 3;
  scene.add(atmosphereMesh);

  // ── Star background (procedural — no texture, no provenance questions) ─
  function buildStars(count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = STAR_RADIUS * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = STAR_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = STAR_RADIUS * Math.sin(phi) * Math.sin(theta);

      const brightness = 0.35 + 0.65 * Math.random();
      color.setHSL(0.6 + 0.12 * Math.random(), 0.35, 0.55 + 0.45 * Math.random());
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false
    });
    return new THREE.Points(geometry, material);
  }
  const stars = buildStars(2400);
  stars.renderOrder = 0;
  scene.add(stars);

  // ── Animation loop ────────────────────────────────────────────────────
  let lastFrameTime = 0;

  function render(dt) {
    // UI-02: pass dt so OrbitControls' auto-rotation is frame-rate independent.
    controls.update(dt);
    renderer.render(scene, camera);
  }

  function animate(timestamp) {
    requestAnimationFrame(animate);
    if (document.hidden) return;

    const dt = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
    lastFrameTime = timestamp;

    // uDrift is kept modulo one texture width: the GPU uniform is float32,
    // so an unbounded accumulator would lose precision and eventually freeze
    // the drift; wrapping is visually identical under RepeatWrapping.
    cloudUniforms.uDrift.value = GC.wrapDrift(
      cloudUniforms.uDrift.value + GC.CLOUD_DRIFT_PER_SECOND * dt
    );

    earthMaterial.uniforms.uCamPos.value.copy(camera.position);
    cloudUniforms.uCamPos.value.copy(camera.position);

    render(dt);
  }

  function onAllTexturesLoaded() {
    earthMaterial.uniforms.uDayTex.value = textures.day;
    earthMaterial.uniforms.uNightTex.value = textures.night;
    earthMaterial.uniforms.uBumpTex.value = textures.bump;
    earthMaterial.uniforms.uSpecTex.value = textures.specular;
    cloudUniforms.uCloudTex.value = textures.clouds;

    updateSolar(state.date);
    started = true;
    // X-04: the canvas becomes a keyboard target only once the globe is
    // actually interactive.
    els.canvas.tabIndex = '0';
    // Successful initialization clears every loading and error state: a slow
    // but successful texture download must never leave a stale failure panel.
    els.error.hidden = true;
    els.loading.hidden = true;
    els.liveBadge.hidden = false;
    lastFrameTime = performance.now();
    animate(lastFrameTime);
  }

  // ── Solar state + panel clock (once per second, not per frame) ───────
  // Coordinates and the UTC date stamp come from the shared DaylightFormat
  // module (A-03); the fixed 24-hour clock remains local because this page
  // has no 12/24-hour preference (unlike the 2D map).
  function updatePanel(date) {
    const subsolar = SM.getSubsolarPoint(date);
    els.utcTime.textContent = `${DF.formatUtcDate(date)} ${date.toISOString().slice(11, 19)} UTC`;
    els.sunPosition.textContent = DF.formatCoord(subsolar.lat, subsolar.lng);
  }

  function tick() {
    if (document.hidden) return;
    if (state.live) state.date = new Date();
    updateSolar(state.date);
    updatePanel(state.date);
  }

  setInterval(tick, SOLAR_UPDATE_MS);

  // ── Lifecycle: pause when hidden, catch up on return ─────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.live) state.date = new Date();
    updateSolar(state.date);
    updatePanel(state.date);
    lastFrameTime = performance.now();
  });

  // ── Resize handling ───────────────────────────────────────────────────
  // userAdjustedDistance tracks whether the user has changed the camera
  // distance via wheel/zoom, keyboard, or touch/pinch. Reset Camera clears
  // it. Resize recomputes the default distance only when the user has not
  // zoomed, so a window resize can adapt the default to the new aspect
  // ratio without overriding a deliberate zoom-in.
  //
  // The wheel listener catches mouse-wheel zoom; the keyboard handlers
  // catch +/-. For touch/pinch and any other OrbitControls-driven zoom
  // (e.g., programmatic or future input), the OrbitControls 'change'
  // event detects distance changes against a baseline captured at the
  // default framing and refreshed by Reset Camera. Rotation-only gestures
  // never change the distance, so they correctly leave the flag false.
  let userAdjustedDistance = false;
  let baselineDistance = camera.position.distanceTo(controls.target);
  els.canvas.addEventListener('wheel', () => { userAdjustedDistance = true; }, { passive: true });
  controls.addEventListener('change', () => {
    const current = camera.position.distanceTo(controls.target);
    if (Math.abs(current - baselineDistance) > 1e-4) {
      userAdjustedDistance = true;
    }
  });

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
    if (!userAdjustedDistance) {
      applyDefaultCameraPosition(camera, defaultCameraDistance(camera, ATMOSPHERE_RADIUS));
      controls.update();
    }
  }
  window.addEventListener('resize', onResize);

  // ── Controls ──────────────────────────────────────────────────────────
  els.toggleClouds.addEventListener('change', () => { cloudMesh.visible = els.toggleClouds.checked; });
  els.toggleAtmosphere.addEventListener('change', () => { atmosphereMesh.visible = els.toggleAtmosphere.checked; });
  els.resetCamera.addEventListener('click', () => {
    applyDefaultCameraPosition(camera, defaultCameraDistance(camera, ATMOSPHERE_RADIUS));
    baselineDistance = camera.position.distanceTo(controls.target);
    controls.target.set(0, 0, 0);
    controls.update();
    render(lastFrameTime ? (performance.now() - lastFrameTime) / 1000 : 1 / 60);
    userAdjustedDistance = false;
  });

  updatePanel(state.date);

  // ── Verification hook (used by automated browser tests) ───────────────
  function samplePixel(cx, cy, width, height) {
    // Render into an offscreen target so sampling works without
    // preserveDrawingBuffer (which would cost a copy per frame in production).
    const rt = new THREE.WebGLRenderTarget(width, height);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);
    rt.dispose();
    const index = (Math.min(height - 1, Math.max(0, cy)) * width + Math.min(width - 1, Math.max(0, cx))) * 4;
    return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
  }

  window.__daylightGlobe = {
    setTime: setDate,
    getSunDirection: () => ({ x: sunDirVector.x, y: sunDirVector.y, z: sunDirVector.z }),
    getSubsolar: () => SM.getSubsolarPoint(state.date),
    // JS mirror of the shader's per-fragment twilight depth (0 at/above the
    // daylight boundary, 1 at/below astronomical): cross-checks that the
    // fragment math and SolarMath agree at any geographic point.
    getTwilightDepthAt: (lat, lng) => GM.twilightDepth(
      GM.sineSolarAltitude(sunDirVector, lat, lng),
      SM.TWILIGHT_THRESHOLDS
    ),
    getState: () => ({ started, live: state.live, date: state.date.toISOString() }),
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
    getControls: () => controls,
    getEarthMesh: () => earthMesh,
    // UI-02: the radius used for default-camera framing decisions. Kept
    // available to the verification handle so E2E tests can confirm the
    // atmosphere bounds the renderer actually uses.
    getAtmosphereRadius: () => ATMOSPHERE_RADIUS,
    getEarthRadius: () => EARTH_RADIUS,
    // Project a representative sample of points on a sphere of the given
    // radius and return the axis-aligned bounding box in normalized device
    // coordinates ([-1, 1] visible). Tests use this to assert that the full
    // Earth/atmosphere fits inside the visible canvas with breathing room.
    projectSphereNdcBounds: (radius) => {
      const samples = [];
      // Equatorial rim at 24 azimuths.
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        samples.push(new THREE.Vector3(radius * Math.cos(a), 0, radius * Math.sin(a)));
      }
      // Polar caps: 6 latitudes from each pole inward.
      for (let i = 1; i <= 6; i += 1) {
        const lat = (i / 7) * Math.PI / 2;
        samples.push(new THREE.Vector3(0, radius * Math.sin(lat), radius * Math.cos(lat)));
        samples.push(new THREE.Vector3(0, -radius * Math.sin(lat), radius * Math.cos(lat)));
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const v = new THREE.Vector3();
      for (const s of samples) {
        v.copy(s).project(camera);
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      return { minX, minY, maxX, maxY };
    },
    sampleCenterPixel: () => {
      const size = renderer.getSize(new THREE.Vector2());
      return samplePixel(Math.floor(size.x / 2), Math.floor(size.y / 2), Math.floor(size.x), Math.floor(size.y));
    },
    render
  };
}());
