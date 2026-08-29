const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const TOKENS = FACE_NAMES.flatMap((face) => [face, `${face}'`, `${face}2`]);

const FACES = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];

const AXIS = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const CLOCKWISE_ANGLE = { U: -90, R: -90, F: -90, D: 90, L: 90, B: 90 };
const TOKEN_SET = new Set(TOKENS);

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, n) {
  return [a[0] * n, a[1] * n, a[2] * n];
}

function equalVector(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function rotateQuarter(vector, axis, angle) {
  const unit = [0, 0, 0];
  unit[AXIS_INDEX[axis]] = 1;
  const parallel = scale(unit, dot(unit, vector));
  const perpendicular = angle > 0 ? cross(unit, vector) : scale(cross(unit, vector), -1);
  return add(parallel, perpendicular);
}

function rotateVector(vector, axis, angle) {
  let result = vector;
  const turns = Math.abs(angle) === 180 ? 2 : 1;
  for (let i = 0; i < turns; i += 1) {
    result = rotateQuarter(result, axis, angle);
  }
  return result;
}

function faceletPosition(faceIndex, row, col) {
  const face = FACES[faceIndex];
  return add(
    face.normal,
    add(scale(face.right, col - 1), scale(face.up, 1 - row)),
  );
}

function findFacelet(position, normal) {
  const faceIndex = FACES.findIndex((face) => equalVector(face.normal, normal));
  if (faceIndex < 0) throw new Error("Rotation produced an invalid face normal");
  const face = FACES[faceIndex];
  const relative = [
    position[0] - face.normal[0],
    position[1] - face.normal[1],
    position[2] - face.normal[2],
  ];
  const col = dot(relative, face.right) + 1;
  const row = 1 - dot(relative, face.up);
  if (row < 0 || row > 2 || col < 0 || col > 2) {
    throw new Error("Rotation produced an invalid facelet position");
  }
  return faceIndex * 9 + row * 3 + col;
}

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

function parseToken(token) {
  assertToken(token);
  const face = token[0];
  const suffix = token.slice(1);
  return {
    face,
    axis: AXIS[face],
    layer: face === "U" || face === "R" || face === "F" ? 1 : -1,
    angle: CLOCKWISE_ANGLE[face] * (suffix === "2" ? 2 : suffix === "'" ? -1 : 1),
  };
}

export function createSolved() {
  const state = new Uint8Array(54);
  for (let face = 0; face < 6; face += 1) {
    state.fill(face, face * 9, face * 9 + 9);
  }
  return state;
}

export function applyMove(state, token) {
  assertState(state);
  const move = parseToken(token);
  const next = new Uint8Array(state);
  const axisIndex = AXIS_INDEX[move.axis];

  for (let face = 0; face < 6; face += 1) {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const position = faceletPosition(face, row, col);
        if (position[axisIndex] !== move.layer) continue;
        const rotatedPosition = rotateVector(position, move.axis, move.angle);
        const rotatedNormal = rotateVector(FACES[face].normal, move.axis, move.angle);
        const destination = findFacelet(rotatedPosition, rotatedNormal);
        next[destination] = state[face * 9 + row * 3 + col];
      }
    }
  }
  return next;
}

export function applyAlgorithm(state, tokens) {
  assertState(state);
  if (!Array.isArray(tokens)) throw new TypeError("algorithm must be an array");
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
    return token.endsWith("'") ? token[0] : `${token[0]}'`;
  });
}

export function isSolved(state) {
  assertState(state);
  for (let face = 0; face < 6; face += 1) {
    const start = face * 9;
    for (let i = 0; i < 9; i += 1) {
      if (state[start + i] !== face) return false;
    }
  }
  return true;
}

export function generateScramble(seed, length) {
  const result = [];
  const numericLength = Number(length);
  const count = Number.isFinite(numericLength) ? Math.max(0, Math.trunc(numericLength)) : 0;
  let value = (Number(seed) >>> 0) || 1;
  let previousAxis = null;
  const nextUint32 = () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value;
  };
  while (result.length < count) {
    const token = TOKENS[nextUint32() % TOKENS.length];
    if (previousAxis !== null && AXIS[token[0]] === previousAxis) continue;
    result.push(token);
    previousAxis = AXIS[token[0]];
  }
  return result;
}

export function serialize(state) {
  assertState(state);
  return Array.from(state, (value) => value.toString(16).padStart(2, "0")).join("");
}

export { FACE_NAMES };
