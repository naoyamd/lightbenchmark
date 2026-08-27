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
const AXES = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };
const TOKEN_RE = /^([URFDLB])(['2]?)$/;

function validateState(state) {
  if (!(state instanceof Uint8Array) || state.length !== 54) {
    throw new TypeError("state must be a Uint8Array(54)");
  }
}

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be a uint32");
  }
  return seed >>> 0 || 1;
}

function xorshift32(seed) {
  let value = validateSeed(seed);
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value;
  };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, amount) {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function key(vector) {
  return vector.join(",");
}

const FACE_BY_NORMAL = new Map(FACE_BASIS.map(({ normal }, face) => [key(normal), face]));

function rotateQuarter(vector, axis, sign) {
  const [x, y, z] = vector;
  if (axis === 0) return sign === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return sign === 1 ? [z, y, -x] : [-z, y, x];
  return sign === 1 ? [-y, x, z] : [y, -x, z];
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
        const destinationFace = FACE_BY_NORMAL.get(key(normal));
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

const PERMUTATIONS = MOVE_SPECS.map((_, face) => (
  Object.fromEntries(SUFFIXES.map((suffix) => [suffix, makePermutation(face, suffix)]))
));

function parseToken(token) {
  if (typeof token !== "string") throw new TypeError("move token must be a string");
  const match = TOKEN_RE.exec(token);
  if (!match) throw new RangeError(`invalid move token: ${token}`);
  return { face: FACE_NAMES.indexOf(match[1]), suffix: match[2] };
}

function parseAlgorithm(tokens) {
  if (typeof tokens === "string") {
    const text = tokens.trim();
    return text === "" ? [] : text.split(/\s+/).map(parseToken);
  }
  if (!Array.isArray(tokens)) throw new TypeError("algorithm must be a token array or string");
  return tokens.map(parseToken);
}

export function createSolved() {
  const state = new Uint8Array(54);
  for (let face = 0; face < 6; face += 1) state.fill(face, face * 9, face * 9 + 9);
  return state;
}

export function applyMove(state, token) {
  validateState(state);
  const { face, suffix } = parseToken(token);
  const permutation = PERMUTATIONS[face][suffix];
  const result = new Uint8Array(54);
  for (let source = 0; source < 54; source += 1) result[permutation[source]] = state[source];
  return result;
}

export function applyAlgorithm(state, tokens) {
  validateState(state);
  const moves = parseAlgorithm(tokens);
  let result = new Uint8Array(state);
  for (const { face, suffix } of moves) {
    const permutation = PERMUTATIONS[face][suffix];
    const next = new Uint8Array(54);
    for (let source = 0; source < 54; source += 1) next[permutation[source]] = result[source];
    result = next;
  }
  return result;
}

export function invertAlgorithm(tokens) {
  const parsed = parseAlgorithm(tokens);
  const inverse = parsed.toReversed().map(({ face, suffix }) => ({
    face,
    suffix: suffix === "" ? "'" : suffix === "'" ? "" : "2",
  }));
  const output = inverse.map(({ face, suffix }) => FACE_NAMES[face] + suffix);
  return typeof tokens === "string" ? output.join(" ") : output;
}

export function isSolved(state) {
  validateState(state);
  for (let face = 0; face < 6; face += 1) {
    for (let offset = 0; offset < 9; offset += 1) {
      if (state[face * 9 + offset] !== face) return false;
    }
  }
  return true;
}

export function generateScramble(seed, length = 25) {
  if (!Number.isInteger(length) || length < 0) throw new RangeError("length must be a non-negative integer");
  const nextUint32 = xorshift32(seed);
  const scramble = [];
  let previousAxis;
  while (scramble.length < length) {
    const token = TOKENS[nextUint32() % TOKENS.length];
    if (previousAxis !== undefined && AXES[token[0]] === previousAxis) continue;
    scramble.push(token);
    previousAxis = AXES[token[0]];
  }
  return scramble;
}

export function serialize(state) {
  validateState(state);
  return Array.from(state, (value) => String(value)).join("");
}

export { FACE_NAMES, TOKENS };

export default {
  createSolved,
  applyMove,
  applyAlgorithm,
  invertAlgorithm,
  isSolved,
  generateScramble,
  serialize,
};
