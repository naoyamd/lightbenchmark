const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const FACE_BASIS = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];
const MOVE_SPECS = [
  { axis: 1, layer: 1, sign: -1 },
  { axis: 0, layer: 1, sign: -1 },
  { axis: 2, layer: 1, sign: -1 },
  { axis: 1, layer: -1, sign: 1 },
  { axis: 0, layer: -1, sign: 1 },
  { axis: 2, layer: -1, sign: 1 },
];
const SUFFIXES = ["", "'", "2"];
const TOKENS = FACE_NAMES.flatMap((face) => SUFFIXES.map((suffix) => face + suffix));
const TOKEN_RE = /^([URFDLB])(['2]?)$/;
const CSS_AXES = ["X", "Y", "Z"];
const FACE_TRANSFORMS = [
  "rotateX(90deg)",   // U: logical +Y is CSS -Y.
  "rotateY(90deg)",   // R
  "rotateY(0deg)",    // F
  "rotateX(-90deg)",  // D
  "rotateY(-90deg)",  // L
  "rotateY(180deg)",  // B
];
const DEFAULT_PALETTE = ["#f7f5d8", "#e96a5f", "#82c18f", "#f3d26e", "#eba16c", "#73a8de"];
const DEFAULT_CAMERA = { yaw: -33, pitch: -26 };
const CUBIE_SIZE = 38;
const CUBIE_GAP = 4;
const CUBIE_PITCH = CUBIE_SIZE + CUBIE_GAP;
const injectedDocuments = new WeakSet();

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, amount) {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function vectorKey(vector) {
  return vector.join(",");
}

const FACE_BY_NORMAL = new Map(FACE_BASIS.map(({ normal }, face) => [vectorKey(normal), face]));

function rotateQuarter(vector, axis, sign) {
  const [x, y, z] = vector;
  if (axis === 0) return sign === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return sign === 1 ? [z, y, -x] : [-z, y, x];
  return sign === 1 ? [-y, x, z] : [y, -x, z];
}

function parseMove(move) {
  if (typeof move !== "string") throw new TypeError("move token must be a string");
  const match = TOKEN_RE.exec(move);
  if (!match) throw new RangeError(`invalid move token: ${move}`);
  return { face: FACE_NAMES.indexOf(match[1]), suffix: match[2] };
}

function makePermutation(face, suffix) {
  const { axis, layer, sign } = MOVE_SPECS[face];
  const turns = suffix === "2" ? 2 : 1;
  const effectiveSign = suffix === "'" ? -sign : sign;
  const permutation = new Uint8Array(54);

  for (let sourceFace = 0; sourceFace < 6; sourceFace += 1) {
    const basis = FACE_BASIS[sourceFace];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const source = sourceFace * 9 + row * 3 + col;
        let position = add(
          add(basis.normal, scale(basis.right, col - 1)),
          scale(basis.up, 1 - row),
        );
        let normal = basis.normal;
        if (position[axis] === layer) {
          for (let turn = 0; turn < turns; turn += 1) {
            position = rotateQuarter(position, axis, effectiveSign);
            normal = rotateQuarter(normal, axis, effectiveSign);
          }
        }
        const destinationFace = FACE_BY_NORMAL.get(vectorKey(normal));
        if (destinationFace === undefined) throw new Error("invalid face basis");
        const destinationBasis = FACE_BASIS[destinationFace];
        const offset = [
          position[0] - destinationBasis.normal[0],
          position[1] - destinationBasis.normal[1],
          position[2] - destinationBasis.normal[2],
        ];
        const destinationCol = dot(offset, destinationBasis.right) + 1;
        const destinationRow = 1 - dot(offset, destinationBasis.up);
        if (!Number.isInteger(destinationRow) || !Number.isInteger(destinationCol)
          || destinationRow < 0 || destinationRow > 2 || destinationCol < 0 || destinationCol > 2) {
          throw new Error("invalid facelet mapping");
        }
        permutation[source] = destinationFace * 9 + destinationRow * 3 + destinationCol;
      }
    }
  }
  return permutation;
}

function faceletGeometry(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 54) {
    throw new RangeError("facelet index must be an integer from 0 through 53");
  }
  const face = Math.floor(index / 9);
  const offset = index % 9;
  const row = Math.floor(offset / 3);
  const col = offset % 3;
  const basis = FACE_BASIS[face];
  const position = add(
    add(basis.normal, scale(basis.right, col - 1)),
    scale(basis.up, 1 - row),
  );
  return {
    index,
    face,
    name: FACE_NAMES[face],
    row,
    col,
    position,
    normal: basis.normal.slice(),
    cubie: position.slice(),
  };
}

function geometryForMove(move) {
  const { face, suffix } = parseMove(move);
  const { axis, layer, sign } = MOVE_SPECS[face];
  const turns = suffix === "2" ? 2 : 1;
  const effectiveSign = suffix === "'" ? -sign : sign;
  // CSS uses Y-down coordinates. X/Z keep the mathematical sign; Y does not.
  const cssAngle = effectiveSign * turns * 90 * (axis === 1 ? 1 : -1);
  const affectedCubies = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const position = [x, y, z];
        if (position[axis] === layer) affectedCubies.push(position);
      }
    }
  }
  const affectedFacelets = [];
  for (let index = 0; index < 54; index += 1) {
    const geometry = faceletGeometry(index);
    if (geometry.position[axis] === layer) affectedFacelets.push(geometry);
  }
  return {
    token: move,
    face,
    faceName: FACE_NAMES[face],
    suffix,
    axis,
    cssAxis: CSS_AXES[axis],
    layer,
    sign: effectiveSign,
    turns,
    cssAngle,
    affectedCubies,
    affectedFacelets,
    permutation: makePermutation(face, suffix),
  };
}

function validateState(state) {
  if (!(state instanceof Uint8Array) && !Array.isArray(state)) {
    throw new TypeError("state must be a Uint8Array(54) or an array of 54 colors");
  }
  if (state.length !== 54) throw new RangeError("state must contain 54 colors");
  const counts = Array(6).fill(0);
  for (const value of state) {
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      throw new RangeError("cube colors must be integers from 0 through 5");
    }
    counts[value] += 1;
  }
  if (counts.some((count) => count !== 9)) {
    throw new RangeError("cube state must contain exactly nine of each color");
  }
  return new Uint8Array(state);
}

function applyGeometryMove(state, move) {
  const source = validateState(state);
  const permutation = geometryForMove(move).permutation;
  const result = new Uint8Array(54);
  for (let index = 0; index < 54; index += 1) {
    result[permutation[index]] = source[index];
  }
  return result;
}

function ensureStyles(document) {
  if (injectedDocuments.has(document)) return;
  const style = document.createElement("style");
  style.dataset.lbCubeView = "true";
  style.textContent = `
.lb-cube-view{position:relative;isolation:isolate;min-height:180px;width:100%;height:100%;overflow:hidden;touch-action:none;outline:none}
.lb-cube-view:focus-visible{outline:2px solid #4a8361;outline-offset:2px}
.lb-cube-viewport{position:absolute;inset:0;overflow:hidden;perspective:760px;perspective-origin:50% 50%}
.lb-cube-orbit{position:absolute;inset:0;transform-style:preserve-3d;transform-origin:50% 50%;will-change:transform}
.lb-cube-scene,.lb-cube-turn{position:absolute;inset:0;transform-style:preserve-3d}
.lb-cube-turn{pointer-events:none;transform-origin:50% 50% 0}
.lb-cube-cubie{position:absolute;left:50%;top:50%;width:var(--lb-cube-size);height:var(--lb-cube-size);transform:translate3d(calc(-50% + var(--lb-cube-tx)),calc(-50% + var(--lb-cube-ty)),var(--lb-cube-tz));transform-style:preserve-3d}
.lb-cube-anchor{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d}
.lb-cube-shell-face,.lb-cube-sticker{position:absolute;left:0;top:0;display:block;box-sizing:border-box;backface-visibility:visible;transform-style:preserve-3d}
.lb-cube-shell-face{width:var(--lb-cube-size);height:var(--lb-cube-size);background:#101417;border:1px solid #030506}
.lb-cube-sticker{width:var(--lb-cube-sticker-size);height:var(--lb-cube-sticker-size);border:2px solid #101417;border-radius:3px;box-shadow:inset 0 -3px #0003}
.lb-cube-reset{position:absolute;right:8px;bottom:8px;padding:5px 8px;border:1px solid #b9c7bb;border-radius:4px;background:#fff;color:#20372a;font:inherit;font-size:11px;line-height:1;cursor:pointer}
.lb-cube-reset:focus-visible{outline:2px solid #4a8361;outline-offset:2px}
@media (prefers-reduced-motion:reduce){.lb-cube-reset{transition:none}}
`;
  (document.head || document.documentElement).append(style);
  injectedDocuments.add(document);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedPalette(options) {
  const palette = options?.colors ?? DEFAULT_PALETTE;
  if (!Array.isArray(palette) || palette.length !== 6 || palette.some((color) => typeof color !== "string")) {
    throw new TypeError("options.colors must contain six CSS color strings");
  }
  return palette.slice();
}

function createCubie(document, position, facelets, state, palette) {
  const cubie = document.createElement("div");
  cubie.className = "lb-cube-cubie";
  cubie.dataset.position = vectorKey(position);
  cubie.style.setProperty("--lb-cube-tx", `${position[0] * CUBIE_PITCH}px`);
  cubie.style.setProperty("--lb-cube-ty", `${-position[1] * CUBIE_PITCH}px`);
  cubie.style.setProperty("--lb-cube-tz", `${position[2] * CUBIE_PITCH}px`);

  for (let face = 0; face < 6; face += 1) {
    const anchor = document.createElement("i");
    anchor.className = "lb-cube-anchor";
    anchor.setAttribute("aria-hidden", "true");
    anchor.style.transform = FACE_TRANSFORMS[face];
    const shellFace = document.createElement("i");
    shellFace.className = "lb-cube-shell-face";
    shellFace.style.transform = `translate3d(-50%,-50%,${CUBIE_SIZE / 2}px)`;
    anchor.append(shellFace);
    cubie.append(anchor);
  }

  for (const facelet of facelets) {
    const anchor = document.createElement("i");
    anchor.className = "lb-cube-anchor lb-cube-sticker-anchor";
    anchor.dataset.face = facelet.name;
    anchor.setAttribute("aria-hidden", "true");
    anchor.style.transform = FACE_TRANSFORMS[facelet.face];
    const sticker = document.createElement("i");
    sticker.className = "lb-cube-sticker";
    sticker.dataset.index = String(facelet.index);
    sticker.dataset.color = String(state[facelet.index]);
    sticker.style.backgroundColor = palette[state[facelet.index]];
    sticker.style.transform = `translate3d(-50%,-50%,${CUBIE_SIZE / 2 + 0.8}px)`;
    anchor.append(sticker);
    cubie.append(anchor);
  }
  return cubie;
}

/**
 * Build one persistent, keyboard and pointer accessible CSS3D cube view.
 * cancel() finishes an active turn at its supplied nextState and resolves it.
 */
export function createCubeView(container, initialState, options = {}) {
  if (!container || typeof container.append !== "function" || !container.ownerDocument) {
    throw new TypeError("container must be a DOM element");
  }
  const state = validateState(initialState);
  const document = container.ownerDocument;
  const palette = normalizedPalette(options);
  ensureStyles(document);

  const root = document.createElement("div");
  root.className = "lb-cube-view";
  root.tabIndex = 0;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.label ?? "3D Rubik's cube");
  root.style.setProperty("--lb-cube-size", `${CUBIE_SIZE}px`);
  root.style.setProperty("--lb-cube-sticker-size", `${CUBIE_SIZE - 7}px`);

  const viewport = document.createElement("div");
  viewport.className = "lb-cube-viewport";
  const orbit = document.createElement("div");
  orbit.className = "lb-cube-orbit";
  const scene = document.createElement("div");
  scene.className = "lb-cube-scene";
  viewport.append(orbit);
  orbit.append(scene);
  root.append(viewport);

  const resetButton = document.createElement("button");
  resetButton.className = "lb-cube-reset";
  resetButton.type = "button";
  resetButton.textContent = options.resetLabel ?? "Reset view";
  resetButton.setAttribute("aria-label", options.resetLabel ?? "Reset cube view");
  root.append(resetButton);
  container.append(root);

  const faceletsByCubie = new Map();
  const stickerByIndex = new Map();
  for (let index = 0; index < 54; index += 1) {
    const facelet = faceletGeometry(index);
    const key = vectorKey(facelet.cubie);
    if (!faceletsByCubie.has(key)) faceletsByCubie.set(key, []);
    faceletsByCubie.get(key).push(facelet);
  }
  const cubieByKey = new Map();
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const position = [x, y, z];
        const cubie = createCubie(document, position, faceletsByCubie.get(vectorKey(position)) ?? [], state, palette);
        cubieByKey.set(vectorKey(position), cubie);
        scene.append(cubie);
        for (const sticker of cubie.querySelectorAll(".lb-cube-sticker")) {
          stickerByIndex.set(Number(sticker.dataset.index), sticker);
        }
      }
    }
  }

  let currentState = state;
  let destroyed = false;
  let active = null;
  let camera = { ...DEFAULT_CAMERA };
  let pointer = null;

  function assertAlive() {
    if (destroyed) throw new Error("cube view has been destroyed");
  }

  function renderCamera() {
    orbit.style.transform = `rotateX(${camera.pitch}deg) rotateY(${camera.yaw}deg)`;
  }

  function updateColors(nextState) {
    for (let index = 0; index < 54; index += 1) {
      const sticker = stickerByIndex.get(index);
      sticker.dataset.color = String(nextState[index]);
      sticker.style.backgroundColor = palette[nextState[index]];
    }
  }

  function resetView() {
    assertAlive();
    camera = { ...DEFAULT_CAMERA };
    renderCamera();
  }

  function finishTurn(operation) {
    if (!active || active !== operation || operation.finished) return;
    operation.finished = true;
    active = null;
    if (operation.raf !== null) {
      (document.defaultView?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(operation.raf);
      operation.raf = null;
    }
    if (operation.timer !== null) {
      clearTimeout(operation.timer);
      operation.timer = null;
    }
    if (operation.animation) {
      operation.animation.onfinish = null;
      operation.animation.oncancel = null;
      try { operation.animation.cancel(); } catch { /* already settled */ }
    }
    operation.layer.style.transform = `rotate${operation.cssAxis}(${operation.cssAngle}deg)`;
    for (const cubie of operation.cubies) scene.append(cubie);
    operation.layer.remove();
    currentState = operation.nextState;
    updateColors(currentState);
    root.removeAttribute("data-animating");
    operation.resolve();
  }

  function cancel() {
    assertAlive();
    if (active) finishTurn(active);
  }

  function turn(move, nextState, { duration = 450, animation } = {}) {
    assertAlive();
    const next = validateState(nextState);
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError("duration must be a non-negative number");
    const geometry = geometryForMove(move);
    const candidateKeyframes = animation === undefined ? null : animationKeyframes(move, animation);
    if (active) cancel();
    for (let index = 0; index < 54; index += 1) {
      if (next[geometry.permutation[index]] !== currentState[index]) {
        throw new RangeError("nextState does not match the requested cube move");
      }
    }

    const layer = document.createElement("div");
    layer.className = "lb-cube-turn";
    layer.dataset.move = geometry.token;
    layer.dataset.affectedFacelets = String(geometry.affectedFacelets.length);
    layer.style.transformOrigin = "50% 50% 0";
    scene.append(layer);
    const cubies = geometry.affectedCubies.map((position) => cubieByKey.get(vectorKey(position)));
    cubies.forEach((cubie) => layer.append(cubie));
    root.dataset.animating = geometry.token;

    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const operation = {
      layer,
      cubies,
      nextState: next,
      cssAxis: geometry.cssAxis,
      cssAngle: geometry.cssAngle,
      animation: null,
      timer: null,
      raf: null,
      resolve,
      finished: false,
    };
    active = operation;
    if (duration === 0) {
      finishTurn(operation);
      return promise;
    }

    const finalTransform = `rotate${geometry.cssAxis}(${geometry.cssAngle}deg)`;
    if (typeof layer.animate === "function") {
      operation.animation = layer.animate(
        candidateKeyframes ?? [{ transform: "rotateX(0deg) rotateY(0deg) rotateZ(0deg)" }, { transform: finalTransform }],
        { duration, easing: candidateKeyframes ? "linear" : "cubic-bezier(.25,.75,.35,1)", fill: "forwards" },
      );
      operation.animation.onfinish = () => finishTurn(operation);
      operation.animation.oncancel = () => finishTurn(operation);
    } else {
      layer.style.transition = `transform ${duration}ms cubic-bezier(.25,.75,.35,1)`;
      const requestFrame = document.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame;
      if (typeof requestFrame === "function") {
        operation.raf = requestFrame(() => {
          operation.raf = null;
          if (!operation.finished) layer.style.transform = finalTransform;
        });
      } else {
        layer.style.transform = finalTransform;
      }
      operation.timer = setTimeout(() => finishTurn(operation), duration);
    }
    return promise;
  }

  function setState(nextState) {
    assertAlive();
    const next = validateState(nextState);
    if (active) cancel();
    currentState = next;
    updateColors(currentState);
  }

  function onPointerDown(event) {
    if (event.target?.closest?.("button") || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    root.focus({ preventScroll: true });
    root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    camera.yaw += dx * 0.5;
    camera.pitch = clamp(camera.pitch + dy * 0.5, -89, 89);
    renderCamera();
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    root.releasePointerCapture?.(event.pointerId);
    pointer = null;
  }

  function onKeyDown(event) {
    let changed = true;
    if (event.key === "ArrowLeft") camera.yaw -= 15;
    else if (event.key === "ArrowRight") camera.yaw += 15;
    else if (event.key === "ArrowUp") camera.pitch = clamp(camera.pitch - 15, -89, 89);
    else if (event.key === "ArrowDown") camera.pitch = clamp(camera.pitch + 15, -89, 89);
    else if (event.key === "Home" || event.key.toLowerCase() === "r") {
      event.preventDefault();
      return resetView();
    }
    else changed = false;
    if (changed) {
      renderCamera();
      event.preventDefault();
    }
  }

  resetButton.addEventListener("click", resetView);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("keydown", onKeyDown);
  renderCamera();

  return {
    setState,
    turn,
    cancel,
    resetView,
    destroy() {
      if (destroyed) return;
      if (active) cancel();
      destroyed = true;
      resetButton.removeEventListener("click", resetView);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("keydown", onKeyDown);
      root.remove();
    },
  };
}

export function getMoveGeometry(move) {
  const geometry = geometryForMove(move);
  return {
    ...geometry,
    affectedCubies: geometry.affectedCubies.map((position) => position.slice()),
    affectedFacelets: geometry.affectedFacelets.map((facelet) => ({
      ...facelet,
      position: facelet.position.slice(),
      normal: facelet.normal.slice(),
      cubie: facelet.cubie.slice(),
    })),
    permutation: new Uint8Array(geometry.permutation),
  };
}

export function animationKeyframes(move, poses) {
  const geometry = geometryForMove(move);
  if (!Array.isArray(poses) || poses.length !== 5) throw new Error('Candidate animation requires five sampled poses');
  let previous = -1e-6;
  return poses.map((pose, index) => {
    if (!pose || pose.axis !== geometry.axis || pose.layer !== geometry.layer || !Number.isFinite(pose.angle)) throw new Error('Candidate animation axis or layer is incorrect');
    const angle = pose.angle * 180 / Math.PI * (pose.axis === 1 ? 1 : -1);
    const fraction = angle / geometry.cssAngle;
    if (fraction < previous - 1e-6 || fraction < -1e-6 || fraction > 1 + 1e-6 || (index === 0 && Math.abs(angle) > 1e-6) || (index === 4 && Math.abs(angle - geometry.cssAngle) > 1e-6) || (index > 0 && index < 4 && !(fraction > 0 && fraction < 1))) throw new Error('Candidate animation has an invalid intermediate or final angle');
    previous = fraction;
    return { offset: index / 4, transform: `rotate${geometry.cssAxis}(${angle}deg)` };
  });
}

export function getMovePermutation(move) {
  return new Uint8Array(geometryForMove(move).permutation);
}

export function getFaceletGeometry(index) {
  const geometry = faceletGeometry(index);
  return {
    ...geometry,
    position: geometry.position.slice(),
    normal: geometry.normal.slice(),
    cubie: geometry.cubie.slice(),
  };
}

export { FACE_BASIS, FACE_NAMES, MOVE_SPECS, TOKENS, applyGeometryMove, parseMove, validateState };

export default createCubeView;
