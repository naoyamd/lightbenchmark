const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const TOKENS = FACE_NAMES.flatMap(face => [face, `${face}'`, `${face}2`]);
const TOKEN_SET = new Set(TOKENS);

const FACES = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];

const MOVES = {
  U: { axis: 1, layer: 1, quarter: -1 },
  R: { axis: 0, layer: 1, quarter: -1 },
  F: { axis: 2, layer: 1, quarter: -1 },
  D: { axis: 1, layer: -1, quarter: 1 },
  L: { axis: 0, layer: -1, quarter: 1 },
  B: { axis: 2, layer: -1, quarter: 1 },
};

function validState(state) {
  if (!(state instanceof Uint8Array) || state.length !== 54) {
    throw new TypeError("state must be a Uint8Array of length 54");
  }
}

function validToken(token) {
  if (typeof token !== "string" || !TOKEN_SET.has(token)) {
    throw new TypeError(`invalid move token: ${String(token)}`);
  }
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sameVector(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function faceletPosition(faceIndex, row, col) {
  const face = FACES[faceIndex];
  return [
    face.normal[0] + (col - 1) * face.right[0] + (1 - row) * face.up[0],
    face.normal[1] + (col - 1) * face.right[1] + (1 - row) * face.up[1],
    face.normal[2] + (col - 1) * face.right[2] + (1 - row) * face.up[2],
  ];
}

function rotateVector(vector, axis, quarter) {
  const [x, y, z] = vector;
  if (axis === 0) return quarter > 0 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return quarter > 0 ? [z, y, -x] : [-z, y, x];
  return quarter > 0 ? [-y, x, z] : [y, -x, z];
}

function rotateByTurns(vector, axis, quarter) {
  let result = vector;
  const steps = Math.abs(quarter);
  const direction = Math.sign(quarter) || 1;
  for (let step = 0; step < steps; step += 1) {
    result = rotateVector(result, axis, direction);
  }
  return result;
}

function faceletIndex(position, normal) {
  for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
    const face = FACES[faceIndex];
    if (!sameVector(face.normal, normal)) continue;
    const delta = [
      position[0] - face.normal[0],
      position[1] - face.normal[1],
      position[2] - face.normal[2],
    ];
    const col = dot(delta, face.right) + 1;
    const row = 1 - dot(delta, face.up);
    if (row >= 0 && row < 3 && col >= 0 && col < 3) {
      return faceIndex * 9 + row * 3 + col;
    }
  }
  throw new Error("could not locate rotated facelet");
}

function movePermutation(faceName, turns) {
  const move = MOVES[faceName];
  const permutation = new Uint8Array(54);
  for (let source = 0; source < 54; source += 1) permutation[source] = source;
  for (let faceIndex = 0; faceIndex < 6; faceIndex += 1) {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const source = faceIndex * 9 + row * 3 + col;
        const position = faceletPosition(faceIndex, row, col);
        if (position[move.axis] !== move.layer) continue;
        const rotatedPosition = rotateByTurns(position, move.axis, move.quarter * turns);
        const rotatedNormal = rotateByTurns(FACES[faceIndex].normal, move.axis, move.quarter * turns);
        permutation[source] = faceletIndex(rotatedPosition, rotatedNormal);
      }
    }
  }
  return permutation;
}

function permutationFor(token) {
  const faceName = token[0];
  const suffix = token.slice(1);
  const turns = suffix === "2" ? 2 : suffix === "'" ? -1 : 1;
  return movePermutation(faceName, turns);
}

function validateTokens(tokens) {
  if (!Array.isArray(tokens)) throw new TypeError("tokens must be an array");
  for (const token of tokens) validToken(token);
}

export function createSolved() {
  const state = new Uint8Array(54);
  for (let face = 0; face < 6; face += 1) {
    state.fill(face, face * 9, face * 9 + 9);
  }
  return state;
}

export function applyMove(state, token) {
  validState(state);
  validToken(token);
  const next = new Uint8Array(54);
  const permutation = permutationFor(token);
  for (let source = 0; source < 54; source += 1) next[permutation[source]] = state[source];
  return next;
}

export function applyAlgorithm(state, tokens) {
  validState(state);
  validateTokens(tokens);
  let next = new Uint8Array(state);
  for (const token of tokens) next = applyMove(next, token);
  return next;
}

export function invertAlgorithm(tokens) {
  validateTokens(tokens);
  return tokens.slice().reverse().map(token => {
    if (token.endsWith("2")) return token;
    return token.endsWith("'") ? token[0] : `${token[0]}'`;
  });
}

export function isSolved(state) {
  validState(state);
  for (let face = 0; face < 6; face += 1) {
    for (let offset = 0; offset < 9; offset += 1) {
      if (state[face * 9 + offset] !== face) return false;
    }
  }
  return true;
}

export function generateScramble(seed, length) {
  if (!Number.isInteger(length) || length < 0) throw new RangeError("length must be a non-negative integer");
  let value = (Number(seed) >>> 0) || 1;
  let previousAxis = null;
  const result = [];
  const axis = token => MOVES[token[0]].axis;
  const nextUint32 = () => {
    value ^= value << 13;
    value >>>= 0;
    value ^= value >>> 17;
    value >>>= 0;
    value ^= value << 5;
    value >>>= 0;
    return value;
  };
  while (result.length < length) {
    const candidate = TOKENS[nextUint32() % TOKENS.length];
    if (axis(candidate) === previousAxis) continue;
    result.push(candidate);
    previousAxis = axis(candidate);
  }
  return result;
}

export function serialize(state) {
  validState(state);
  return Array.from(state, value => value.toString(16).padStart(2, "0")).join("");
}
