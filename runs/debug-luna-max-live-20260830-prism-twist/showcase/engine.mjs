const FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const TOKENS = FACE_NAMES.flatMap((face) => [face, `${face}'`, `${face}2`]);
const TOKEN_SET = new Set(TOKENS);
const AXIS_BY_FACE = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };

// The basis vectors are the ones used by the public-v1 contract.  Keeping the
// geometry here (instead of a hand-written sticker table) makes every move
// obey the same coordinate convention.
const FACE_INFO = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];

const MOVE_INFO = {
  U: { axis: "y", layer: 1, direction: -1 },
  R: { axis: "x", layer: 1, direction: -1 },
  F: { axis: "z", layer: 1, direction: -1 },
  D: { axis: "y", layer: -1, direction: 1 },
  L: { axis: "x", layer: -1, direction: 1 },
  B: { axis: "z", layer: -1, direction: 1 },
};

const keyOf = (position, normal) => `${position[0]},${position[1]},${position[2]}|${normal[0]},${normal[1]},${normal[2]}`;

const FACELETS = [];
const POSITION_TO_INDEX = new Map();
for (let face = 0; face < FACE_INFO.length; face += 1) {
  const { normal, right, up } = FACE_INFO[face];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const position = [
        normal[0] + (col - 1) * right[0] + (1 - row) * up[0],
        normal[1] + (col - 1) * right[1] + (1 - row) * up[1],
        normal[2] + (col - 1) * right[2] + (1 - row) * up[2],
      ];
      const index = face * 9 + row * 3 + col;
      FACELETS[index] = { position, normal };
      POSITION_TO_INDEX.set(keyOf(position, normal), index);
    }
  }
}

function assertState(state) {
  if (!(state instanceof Uint8Array) || state.length !== 54) {
    throw new TypeError("state must be a Uint8Array(54)");
  }
}

function assertToken(token) {
  if (typeof token !== "string" || !TOKEN_SET.has(token)) {
    throw new TypeError(`invalid move token: ${String(token)}`);
  }
}

function assertTokens(tokens) {
  if (!Array.isArray(tokens)) {
    throw new TypeError("algorithm must be an array of move tokens");
  }
  for (const token of tokens) assertToken(token);
}

function rotateQuarter(vector, axis, direction) {
  const [x, y, z] = vector;
  // A positive turn is the right-hand +90 degree rotation.  The negative
  // branch is its inverse; all components remain integral in this puzzle.
  if (axis === "x") {
    return direction > 0 ? [x, -z, y] : [x, z, -y];
  }
  if (axis === "y") {
    return direction > 0 ? [z, y, -x] : [-z, y, x];
  }
  return direction > 0 ? [-y, x, z] : [y, -x, z];
}

function turnedFacelet(facelet, move, turns) {
  let position = facelet.position.slice();
  let normal = facelet.normal.slice();
  for (let i = 0; i < turns; i += 1) {
    position = rotateQuarter(position, move.axis, move.direction);
    normal = rotateQuarter(normal, move.axis, move.direction);
  }
  return { position, normal };
}

function tokenParts(token) {
  const face = token[0];
  const suffix = token.slice(1);
  return { move: MOVE_INFO[face], turns: suffix === "2" ? 2 : suffix === "'" ? 3 : 1 };
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
  assertToken(token);
  const { move, turns } = tokenParts(token);
  const result = new Uint8Array(state);

  for (let sourceIndex = 0; sourceIndex < FACELETS.length; sourceIndex += 1) {
    const source = FACELETS[sourceIndex];
    if (source.position[move.axis === "x" ? 0 : move.axis === "y" ? 1 : 2] !== move.layer) continue;
    const destination = turnedFacelet(source, move, turns);
    const destinationIndex = POSITION_TO_INDEX.get(keyOf(destination.position, destination.normal));
    if (destinationIndex === undefined) throw new Error("facelet rotation left the cube");
    result[destinationIndex] = state[sourceIndex];
  }
  return result;
}

export function applyAlgorithm(state, tokens) {
  assertState(state);
  // Validate the complete algorithm before the first transition.  The
  // function is pure in any case, but this makes the atomic contract explicit.
  assertTokens(tokens);
  let result = new Uint8Array(state);
  for (const token of tokens) result = applyMove(result, token);
  return result;
}

export function invertAlgorithm(tokens) {
  assertTokens(tokens);
  return tokens.slice().reverse().map((token) => {
    if (token.endsWith("2")) return token;
    if (token.endsWith("'")) return token[0];
    return `${token}'`;
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
  let x = Number(seed) >>> 0;
  if (x === 0) x = 1;
  const nextUint32 = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x >>>= 0;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };

  const result = [];
  let previousAxis = null;
  while (result.length < length) {
    const token = TOKENS[nextUint32() % TOKENS.length];
    if (AXIS_BY_FACE[token[0]] === previousAxis) continue;
    result.push(token);
    previousAxis = AXIS_BY_FACE[token[0]];
  }
  return result;
}

export function serialize(state) {
  assertState(state);
  return Array.from(state, (value) => String(value)).join(",");
}

