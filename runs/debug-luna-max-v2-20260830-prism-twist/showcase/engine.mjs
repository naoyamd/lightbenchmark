const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const TOKENS = FACE_NAMES.flatMap((face) => [face, `${face}'`, `${face}2`]);
const TOKEN_SET = new Set(TOKENS);

// The basis vectors are the public-v1 convention: x is right, y is up,
// and z points toward the front of the cube.
const FACES = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];

const MOVE_INFO = {
  U: { axis: 1, layer: 1, angle: -90 },
  R: { axis: 0, layer: 1, angle: -90 },
  F: { axis: 2, layer: 1, angle: -90 },
  D: { axis: 1, layer: -1, angle: 90 },
  L: { axis: 0, layer: -1, angle: 90 },
  B: { axis: 2, layer: -1, angle: 90 },
};

const key = (position, normal) => `${position.join(",")}|${normal.join(",")}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, amount) => [a[0] * amount, a[1] * amount, a[2] * amount];

const FACELET_GEOMETRY = [];
const FACELET_INDEX = new Map();
for (let face = 0; face < FACES.length; face += 1) {
  const basis = FACES[face];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const position = add(
        add(basis.normal, scale(basis.right, col - 1)),
        scale(basis.up, 1 - row),
      );
      const index = face * 9 + row * 3 + col;
      const geometry = { position, normal: basis.normal.slice(), index };
      FACELET_GEOMETRY[index] = geometry;
      FACELET_INDEX.set(key(position, basis.normal), index);
    }
  }
}

function rotateQuarter(vector, axis, angle) {
  const [x, y, z] = vector;
  if (axis === 0) return angle > 0 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return angle > 0 ? [z, y, -x] : [-z, y, x];
  return angle > 0 ? [-y, x, z] : [y, -x, z];
}

function buildMoveMap(face) {
  const info = MOVE_INFO[face];
  const map = new Uint8Array(54);
  for (let index = 0; index < FACELET_GEOMETRY.length; index += 1) {
    const { position, normal } = FACELET_GEOMETRY[index];
    const targetPosition = position[info.axis] === info.layer
      ? rotateQuarter(position, info.axis, info.angle)
      : position;
    const targetNormal = position[info.axis] === info.layer
      ? rotateQuarter(normal, info.axis, info.angle)
      : normal;
    const target = FACELET_INDEX.get(key(targetPosition, targetNormal));
    if (target === undefined) throw new Error(`Could not map facelet ${index}`);
    map[index] = target;
  }
  return map;
}

const MOVE_MAPS = Object.fromEntries(FACE_NAMES.map((face) => [face, buildMoveMap(face)]));

function assertState(state) {
  if (!(state instanceof Uint8Array) || state.length !== 54) {
    throw new TypeError("state must be a Uint8Array(54)");
  }
}

function assertToken(token) {
  if (typeof token !== "string" || !TOKEN_SET.has(token)) {
    throw new Error(`Invalid move token: ${String(token)}`);
  }
}

function turnsFor(token) {
  return token.endsWith("2") ? 2 : 1;
}

export function createSolved() {
  const state = new Uint8Array(54);
  for (let face = 0; face < 6; face += 1) state.fill(face, face * 9, face * 9 + 9);
  return state;
}

export function applyMove(state, token) {
  assertState(state);
  assertToken(token);
  const face = token[0];
  const map = MOVE_MAPS[face];
  let result = new Uint8Array(state);
  for (let turn = 0; turn < turnsFor(token); turn += 1) {
    const next = new Uint8Array(54);
    for (let source = 0; source < 54; source += 1) next[map[source]] = result[source];
    result = next;
  }
  if (token.endsWith("'")) {
    // A prime is the inverse of the clockwise quarter-turn. Applying the
    // clockwise map three times keeps the implementation table-driven.
    let inverse = new Uint8Array(state);
    for (let turn = 0; turn < 3; turn += 1) {
      const next = new Uint8Array(54);
      for (let source = 0; source < 54; source += 1) next[map[source]] = inverse[source];
      inverse = next;
    }
    return inverse;
  }
  return result;
}

export function applyAlgorithm(state, tokens) {
  assertState(state);
  if (!Array.isArray(tokens)) throw new TypeError("algorithm must be an array");
  // Validate the complete algorithm before doing any work, making rejection
  // atomic even when a later token is malformed.
  for (const token of tokens) assertToken(token);
  let result = new Uint8Array(state);
  for (const token of tokens) result = applyMove(result, token);
  return result;
}

export function invertAlgorithm(tokens) {
  if (!Array.isArray(tokens)) throw new TypeError("algorithm must be an array");
  for (const token of tokens) assertToken(token);
  return tokens.slice().reverse().map((token) => {
    if (token.endsWith("2")) return token;
    return token.endsWith("'") ? token[0] : `${token}'`;
  });
}

export function isSolved(state) {
  assertState(state);
  for (let face = 0; face < 6; face += 1) {
    const expected = face;
    for (let offset = 0; offset < 9; offset += 1) {
      if (state[face * 9 + offset] !== expected) return false;
    }
  }
  return true;
}

export function generateScramble(seed, length) {
  if (!Number.isInteger(length) || length < 0) throw new RangeError("length must be a non-negative integer");
  let x = (Number(seed) >>> 0) || 1;
  const result = [];
  let previousAxis = -1;
  while (result.length < length) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x >>>= 0;
    x ^= x << 5;
    x >>>= 0;
    const candidateIndex = x % 18;
    const candidate = TOKENS[candidateIndex];
    const axis = MOVE_INFO[candidate[0]].axis;
    if (axis === previousAxis) continue;
    result.push(candidate);
    previousAxis = axis;
  }
  return result;
}

export function serialize(state) {
  assertState(state);
  return Array.from(state, (value) => String(value)).join("");
}
