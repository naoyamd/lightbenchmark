const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const TOKENS = [
  "U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2",
  "D", "D'", "D2", "L", "L'", "L2", "B", "B'", "B2",
];

const GEOMETRY = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];

const MOVE_INFO = {
  U: { axis: 1, layer: 1, quarter: -1 },
  R: { axis: 0, layer: 1, quarter: -1 },
  F: { axis: 2, layer: 1, quarter: -1 },
  D: { axis: 1, layer: -1, quarter: 1 },
  L: { axis: 0, layer: -1, quarter: 1 },
  B: { axis: 2, layer: -1, quarter: 1 },
};

const TOKEN_SET = new Set(TOKENS);
const SCRAMBLE_TOKENS = TOKENS.slice();

function assertState(state) {
  if (!(state instanceof Uint8Array) || state.length !== 54) {
    throw new TypeError("state must be a Uint8Array(54)");
  }
}

function parseToken(token) {
  if (typeof token !== "string" || !TOKEN_SET.has(token)) {
    throw new Error(`Invalid move token: ${String(token)}`);
  }
  const face = token[0];
  return { face, amount: token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1 };
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, n) {
  return [a[0] * n, a[1] * n, a[2] * n];
}

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

function rotateQuarter(vector, axis, quarter) {
  const unit = [0, 0, 0];
  unit[axis] = 1;
  const axial = scale(unit, dot(unit, vector));
  const sideways = cross(unit, vector);
  return add(axial, scale(sideways, quarter));
}

function destinationIndex(position, normal) {
  let face = -1;
  for (let i = 0; i < GEOMETRY.length; i += 1) {
    if (dot(GEOMETRY[i].normal, normal) === 1) {
      face = i;
      break;
    }
  }
  if (face < 0) throw new Error("Could not map rotated facelet");
  const geometry = GEOMETRY[face];
  const local = [
    position[0] - normal[0],
    position[1] - normal[1],
    position[2] - normal[2],
  ];
  const col = dot(local, geometry.right) + 1;
  const row = 1 - dot(local, geometry.up);
  if (row < 0 || row > 2 || col < 0 || col > 2) {
    throw new Error("Could not map rotated facelet coordinates");
  }
  return face * 9 + row * 3 + col;
}

function buildMoveMap(face) {
  const info = MOVE_INFO[face];
  const map = new Uint8Array(54);
  const geometry = GEOMETRY;
  for (let sourceFace = 0; sourceFace < 6; sourceFace += 1) {
    const source = geometry[sourceFace];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const sourceIndex = sourceFace * 9 + row * 3 + col;
        const position = add(
          source.normal,
          add(scale(source.right, col - 1), scale(source.up, 1 - row)),
        );
        let destination = position;
        let destinationNormal = source.normal;
        if (position[info.axis] === info.layer) {
          destination = rotateQuarter(position, info.axis, info.quarter);
          destinationNormal = rotateQuarter(source.normal, info.axis, info.quarter);
        }
        map[sourceIndex] = destinationIndex(destination, destinationNormal);
      }
    }
  }
  return map;
}

const MOVE_MAPS = Object.fromEntries(FACE_NAMES.map((face) => [face, buildMoveMap(face)]));

export function createSolved() {
  const state = new Uint8Array(54);
  for (let face = 0; face < 6; face += 1) {
    state.fill(face, face * 9, face * 9 + 9);
  }
  return state;
}

export function applyMove(state, token) {
  assertState(state);
  const { face, amount } = parseToken(token);
  let result = new Uint8Array(state);
  const map = MOVE_MAPS[face];
  for (let turn = 0; turn < amount; turn += 1) {
    const next = new Uint8Array(54);
    for (let source = 0; source < 54; source += 1) {
      next[map[source]] = result[source];
    }
    result = next;
  }
  return result;
}

export function applyAlgorithm(state, tokens) {
  assertState(state);
  if (!Array.isArray(tokens)) throw new TypeError("algorithm must be an array");
  // Validate every token before applying even the first one: algorithms are atomic.
  for (const token of tokens) parseToken(token);
  let result = new Uint8Array(state);
  for (const token of tokens) result = applyMove(result, token);
  return result;
}

export function invertAlgorithm(tokens) {
  if (!Array.isArray(tokens)) throw new TypeError("algorithm must be an array");
  for (const token of tokens) parseToken(token);
  return tokens.slice().reverse().map((token) => {
    if (token.endsWith("2")) return token;
    if (token.endsWith("'")) return token[0];
    return `${token[0]}'`;
  });
}

export function isSolved(state) {
  assertState(state);
  for (let face = 0; face < 6; face += 1) {
    const expected = face;
    for (let i = 0; i < 9; i += 1) {
      if (state[face * 9 + i] !== expected) return false;
    }
  }
  return true;
}

export function generateScramble(seed, length) {
  if (!Number.isInteger(length) || length < 0) throw new RangeError("length must be a non-negative integer");
  let x = (Number(seed) >>> 0) || 1;
  const nextUint32 = () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x >>> 0;
  };
  const axes = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };
  const result = [];
  let previousAxis = null;
  while (result.length < length) {
    const token = SCRAMBLE_TOKENS[nextUint32() % 18];
    if (previousAxis !== null && axes[token[0]] === previousAxis) continue;
    result.push(token);
    previousAxis = axes[token[0]];
  }
  return result;
}

export function serialize(state) {
  assertState(state);
  return Array.from(state, (value) => value.toString(16).padStart(2, "0")).join("");
}
