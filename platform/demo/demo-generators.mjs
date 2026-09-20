/*
 * Reference mock code for the platform-review page.
 * ponytail: fixed chain skeleton and inverse cube replay; actual scoring must use candidate artifacts.
 *
 * This file is deliberately self-contained because the review page is served
 * from this directory. It is a visual replay generator, never candidate
 * starter code or production evaluation code. The cube inverse is only a
 * reference visual shortcut; a main solver must not receive the scramble log
 * and production should solve from the observed state (blind state solving).
 */

const PUYO_RULES = { width: 6, height: 14, colors: 4, clearThreshold: 4 };
const PUYO_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PUYO_BASE_BOARD = [
  [1, 3, 3, 4, 1, 3],
  [1, 1, 4, 3, 1, 1],
  [4, 2, 3, 4, 2, 4],
  [1, 4, 4, 1, 1, 4],
  [4, 4, 1, 2, 1, 4],
  [3, 2, 3, 3, 4, 1],
  [0, 1, 2, 4, 1, 3],
  [0, 4, 2, 3, 1, 3],
  [0, 1, 3, 1, 4, 3],
  [0, 4, 1, 1, 2, 2],
  [0, 4, 4, 3, 2, 4],
  [0, 1, 1, 2, 4, 1],
  [0, 3, 1, 2, 0, 1],
  [0, 0, 3, 0, 0, 2],
];

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be a uint32");
  }
  return seed >>> 0;
}

function blankPuyoBoard() {
  return Array.from({ length: PUYO_RULES.height }, () => Array(PUYO_RULES.width).fill(0));
}

function validatePuyoBoard(board) {
  if (!Array.isArray(board) || board.length !== PUYO_RULES.height
    || board.some((row) => !Array.isArray(row) || row.length !== PUYO_RULES.width)) {
    throw new RangeError("board must be a 14 by 6 array");
  }
  for (const row of board) {
    for (const cell of row) {
      if (!Number.isInteger(cell) || cell < 0 || cell > PUYO_RULES.colors) {
        throw new RangeError("board cells must be integers from 0 through 4");
      }
    }
  }
}

function clonePuyoBoard(board) {
  validatePuyoBoard(board);
  return board.map((row) => row.slice());
}

function findPuyoGroups(board) {
  validatePuyoBoard(board);
  const seen = board.map((row) => row.map(() => false));
  const groups = [];
  for (let y = 0; y < PUYO_RULES.height; y += 1) {
    for (let x = 0; x < PUYO_RULES.width; x += 1) {
      const color = board[y][x];
      if (color === 0 || seen[y][x]) continue;
      const queue = [[x, y]];
      const cells = [];
      seen[y][x] = true;
      for (let index = 0; index < queue.length; index += 1) {
        const [cx, cy] = queue[index];
        cells.push([cx, cy]);
        for (const [dx, dy] of PUYO_DIRECTIONS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= PUYO_RULES.width || ny < 0 || ny >= PUYO_RULES.height
            || seen[ny][nx] || board[ny][nx] !== color) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      if (cells.length >= PUYO_RULES.clearThreshold) {
        cells.sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
        groups.push({ color, cells });
      }
    }
  }
  groups.sort((a, b) => {
    const [ax, ay] = a.cells[0];
    const [bx, by] = b.cells[0];
    return ay - by || ax - bx;
  });
  return groups;
}

function applyPuyoGravity(board) {
  validatePuyoBoard(board);
  const result = board.map((row) => row.slice());
  for (let x = 0; x < PUYO_RULES.width; x += 1) {
    const cells = [];
    for (let y = 0; y < PUYO_RULES.height; y += 1) {
      if (result[y][x] !== 0) cells.push(result[y][x]);
    }
    for (let y = 0; y < PUYO_RULES.height; y += 1) result[y][x] = cells[y] ?? 0;
  }
  return result;
}

function resolvePuyo(board) {
  let current = clonePuyoBoard(board);
  const steps = [];
  while (true) {
    const groups = findPuyoGroups(current);
    if (groups.length === 0) break;
    const cleared = groups.flatMap(({ cells }) => cells)
      .sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
    for (const [x, y] of cleared) current[y][x] = 0;
    const boardAfter = applyPuyoGravity(current);
    steps.push({
      chain: steps.length + 1,
      groups,
      cleared,
      boardAfter: boardAfter.map((row) => row.slice()),
    });
    current = boardAfter;
  }
  return { finalBoard: current, chainCount: steps.length, steps };
}

function validPuyoPair(pair) {
  return pair && Number.isInteger(pair.x) && Number.isInteger(pair.rotation)
    && pair.rotation >= 0 && pair.rotation <= 3 && Array.isArray(pair.colors)
    && pair.colors.length === 2 && pair.colors.every((color) => Number.isInteger(color)
      && color >= 1 && color <= PUYO_RULES.colors);
}

function dropPuyoPair(board, pair) {
  let original;
  try {
    original = clonePuyoBoard(board);
  } catch {
    return {
      ok: false,
      board: Array.isArray(board) ? board.map((row) => row?.slice?.() ?? row) : board,
      reason: "invalid",
    };
  }
  if (!validPuyoPair(pair)) return { ok: false, board: original, reason: "invalid" };

  const { x, rotation, colors: [pivotColor, childColor] } = pair;
  const offsets = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const [dx, dy] = offsets[rotation];
  const childX = x + dx;
  if (x < 0 || x >= PUYO_RULES.width || childX < 0 || childX >= PUYO_RULES.width) {
    return { ok: false, board: original, reason: "invalid" };
  }

  const result = original.map((row) => row.slice());
  const canPlace = (pivotY) => {
    const childY = pivotY + dy;
    return pivotY >= 0 && pivotY < PUYO_RULES.height && childY >= 0 && childY < PUYO_RULES.height
      && result[pivotY][x] === 0 && result[childY][childX] === 0;
  };
  let pivotY = PUYO_RULES.height - 1 - Math.max(0, dy);
  if (!canPlace(pivotY)) return { ok: false, board: original, reason: "overflow" };
  while (canPlace(pivotY - 1)) pivotY -= 1;
  result[pivotY][x] = pivotColor;
  result[pivotY + dy][childX] = childColor;

  if (dy === 0) {
    for (const [cellX, cellY, color] of [[x, pivotY, pivotColor], [childX, pivotY, childColor]]) {
      if (cellY === 0 || result[cellY - 1][cellX] !== 0) continue;
      result[cellY][cellX] = 0;
      let settledY = cellY;
      while (settledY > 0 && result[settledY - 1][cellX] === 0) settledY -= 1;
      result[settledY][cellX] = color;
    }
  }
  return { ok: true, board: result };
}

function nextPuyoRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>>= 0;
  };
}

function transformPuyoChallenge(goal, seed) {
  const next = nextPuyoRandom(seed);
  const colors = [1, 2, 3, 4];
  for (let index = colors.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [colors[index], colors[swap]] = [colors[swap], colors[index]];
  }
  const mirror = Boolean(next() & 1);
  const recolor = (cell) => cell === 0 ? 0 : colors[cell - 1];
  const board = clonePuyoBoard(goal.board)
    .map((row) => (mirror ? row.slice().reverse() : row).map(recolor));
  const pair = {
    x: mirror ? PUYO_RULES.width - 1 - goal.pair.x : goal.pair.x,
    rotation: mirror && goal.pair.rotation % 2 === 1
      ? (goal.pair.rotation === 1 ? 3 : 1) : goal.pair.rotation,
    colors: goal.pair.colors.map(recolor),
  };
  return { board, pair };
}

function planPuyoChallenge(goal, seed = 0) {
  const board = clonePuyoBoard(goal?.board);
  if (!validPuyoPair(goal?.pair) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("goal and seed are invalid");
  }
  const columns = Array.from({ length: PUYO_RULES.width }, (_, x) => (
    board.map((row) => row[x]).filter(Boolean)
  ));
  const heights = columns.map((column) => column.length);
  if (heights.reduce((total, height) => total + height, 0) % 2 !== 0) {
    throw new RangeError("goal needs an even cell count");
  }

  const used = Array(PUYO_RULES.width).fill(0);
  const setupPairs = [];
  let incoming = 0;
  for (let x = 0; x < PUYO_RULES.width - 1; x += 1) {
    const edge = (heights[x] & 1) ^ incoming;
    if (edge) {
      if (used[x] >= heights[x] || used[x + 1] >= heights[x + 1]) {
        throw new RangeError("goal cannot be paired by adjacent drops");
      }
      setupPairs.push({
        x,
        rotation: 1,
        colors: [columns[x][used[x]], columns[x + 1][used[x + 1]]],
      });
      used[x] += 1;
      used[x + 1] += 1;
    }
    incoming = edge;
  }
  if (((heights[heights.length - 1] - used[used.length - 1]) & 1) !== 0) {
    throw new RangeError("goal cannot be paired by adjacent drops");
  }

  const queues = columns.map((column, x) => {
    const pairs = [];
    for (let y = used[x]; y < column.length; y += 2) {
      if (y + 1 >= column.length) throw new RangeError("goal leaves an unpaired cell");
      pairs.push({ x, rotation: 0, colors: [column[y], column[y + 1]] });
    }
    return pairs;
  });
  const next = nextPuyoRandom(seed);
  while (queues.some((queue) => queue.length)) {
    const available = queues.map((queue, x) => queue.length ? x : -1).filter((x) => x >= 0);
    setupPairs.push(queues[available[next() % available.length]].shift());
  }
  return {
    seed: seed >>> 0,
    setupPairs,
    triggerPair: { x: goal.pair.x, rotation: goal.pair.rotation, colors: goal.pair.colors.slice() },
  };
}

function clonePuyoPair(pair) {
  return { x: pair.x, rotation: pair.rotation, colors: pair.colors.slice() };
}

function makePuyoFrame(phase, board, placed, chain) {
  return {
    phase,
    board: clonePuyoBoard(board),
    placed: placed ? clonePuyoPair(placed) : null,
    chain,
  };
}

/** Build the complete empty-board -> 18-chain reference replay for a reset. */
export function makePuyoDemo(seed) {
  const normalizedSeed = validateSeed(seed);
  const baseBoard = PUYO_BASE_BOARD.map((row) => row.slice());
  baseBoard[4][0] = 0;
  baseBoard[5][0] = 0;
  const baseGoal = {
    board: applyPuyoGravity(baseBoard),
    pair: { x: 0, rotation: 0, colors: [4, 3] },
  };
  const goal = transformPuyoChallenge(baseGoal, normalizedSeed);
  const plan = planPuyoChallenge(goal, normalizedSeed);
  const empty = blankPuyoBoard();
  const frames = [makePuyoFrame("setup", empty, null, 0)];
  let board = empty;

  for (const pair of plan.setupPairs) {
    const dropped = dropPuyoPair(board, pair);
    if (!dropped.ok || resolvePuyo(dropped.board).chainCount !== 0) {
      throw new Error("reference planner produced an illegal setup drop");
    }
    board = dropped.board;
    frames.push(makePuyoFrame("setup", board, pair, 0));
  }
  const trigger = dropPuyoPair(board, plan.triggerPair);
  if (!trigger.ok) throw new Error("reference trigger did not fit");
  frames.push(makePuyoFrame("trigger", trigger.board, plan.triggerPair, 0));
  const result = resolvePuyo(trigger.board);
  for (const step of result.steps) frames.push({
    ...makePuyoFrame("chain", step.boardAfter, null, step.chain),
    cleared: step.cleared.map(cell => [...cell]),
  });
  if (result.chainCount !== 18 || !result.finalBoard.flat().every((cell) => cell === 0)) {
    throw new Error("reference trigger did not produce an 18-chain all clear");
  }

  return {
    seed: normalizedSeed,
    setupPairs: plan.setupPairs.map(clonePuyoPair),
    triggerPair: clonePuyoPair(plan.triggerPair),
    goal: { board: clonePuyoBoard(goal.board), pair: clonePuyoPair(goal.pair) },
    frames,
    chainCount: result.chainCount,
    allClear: result.finalBoard.flat().every((cell) => cell === 0),
  };
}

/** Surviving pieces keep their identity while falling after a clear. */
export function puyoFalls(board, cleared) {
  validatePuyoBoard(board);
  const removed = new Set(cleared.map(([x, y]) => `${x},${y}`));
  const moves = [];
  for (let x = 0; x < 6; x++) {
    let targetY = 0;
    for (let y = 0; y < 14; y++) {
      if (board[y][x] && !removed.has(`${x},${y}`)) {
        moves.push({x, fromY: y, toY: targetY++, color: board[y][x]});
      }
    }
  }
  return moves;
}

// Cube reference mock, copied as a local oracle so the browser page has no
// dependency on evaluator/cube.mjs.
const CUBE_FACE_NAMES = ["U", "R", "F", "D", "L", "B"];
const CUBE_FACE_BASIS = [
  { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];
const CUBE_MOVE_SPECS = [
  { axis: 1, layer: 1, sign: -1 },
  { axis: 0, layer: 1, sign: -1 },
  { axis: 2, layer: 1, sign: -1 },
  { axis: 1, layer: -1, sign: 1 },
  { axis: 0, layer: -1, sign: 1 },
  { axis: 2, layer: -1, sign: 1 },
];
const CUBE_SUFFIXES = ["", "'", "2"];
const CUBE_TOKENS = CUBE_FACE_NAMES.flatMap((face) => CUBE_SUFFIXES.map((suffix) => face + suffix));
const CUBE_AXES = { U: "y", D: "y", R: "x", L: "x", F: "z", B: "z" };

function cubeDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cubeAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function cubeScale(a, amount) {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function cubeKey(vector) {
  return vector.join(",");
}

const CUBE_FACE_BY_NORMAL = new Map(CUBE_FACE_BASIS.map(({ normal }, face) => [cubeKey(normal), face]));

function rotateCubeQuarter(vector, axis, sign) {
  const [x, y, z] = vector;
  if (axis === 0) return sign === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return sign === 1 ? [z, y, -x] : [-z, y, x];
  return sign === 1 ? [-y, x, z] : [y, -x, z];
}

function makeCubePermutation(face, suffix) {
  const { axis, layer, sign } = CUBE_MOVE_SPECS[face];
  const turns = suffix === "2" ? 2 : 1;
  const effectiveSign = suffix === "'" ? -sign : sign;
  const permutation = new Uint8Array(54);
  for (let sourceFace = 0; sourceFace < 6; sourceFace += 1) {
    const basis = CUBE_FACE_BASIS[sourceFace];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const source = sourceFace * 9 + row * 3 + col;
        let position = cubeAdd(
          cubeAdd(basis.normal, cubeScale(basis.right, col - 1)),
          cubeScale(basis.up, 1 - row),
        );
        let normal = basis.normal;
        if (position[axis] === layer) {
          for (let turn = 0; turn < turns; turn += 1) {
            position = rotateCubeQuarter(position, axis, effectiveSign);
            normal = rotateCubeQuarter(normal, axis, effectiveSign);
          }
        }
        const destinationFace = CUBE_FACE_BY_NORMAL.get(cubeKey(normal));
        if (destinationFace === undefined) throw new Error("invalid cube face basis");
        const destinationBasis = CUBE_FACE_BASIS[destinationFace];
        const offset = [
          position[0] - destinationBasis.normal[0],
          position[1] - destinationBasis.normal[1],
          position[2] - destinationBasis.normal[2],
        ];
        const destinationCol = cubeDot(offset, destinationBasis.right) + 1;
        const destinationRow = 1 - cubeDot(offset, destinationBasis.up);
        if (!Number.isInteger(destinationRow) || !Number.isInteger(destinationCol)
          || destinationRow < 0 || destinationRow > 2 || destinationCol < 0 || destinationCol > 2) {
          throw new Error("invalid cube facelet mapping");
        }
        permutation[source] = destinationFace * 9 + destinationRow * 3 + destinationCol;
      }
    }
  }
  return permutation;
}

const CUBE_PERMUTATIONS = CUBE_MOVE_SPECS.map((_, face) => (
  Object.fromEntries(CUBE_SUFFIXES.map((suffix) => [suffix, makeCubePermutation(face, suffix)]))
));

function validateCubeState(state) {
  if (!(state instanceof Uint8Array) || state.length !== 54) {
    throw new TypeError("state must be a Uint8Array(54)");
  }
}

function parseCubeToken(token) {
  if (typeof token !== "string") throw new TypeError("move token must be a string");
  const match = /^([URFDLB])(['2]?)$/.exec(token);
  if (!match) throw new RangeError(`invalid move token: ${token}`);
  return { face: CUBE_FACE_NAMES.indexOf(match[1]), suffix: match[2] };
}

function createCubeSolved() {
  const state = new Uint8Array(54);
  for (let face = 0; face < 6; face += 1) state.fill(face, face * 9, face * 9 + 9);
  return state;
}

function applyCubeMove(state, token) {
  validateCubeState(state);
  const { face, suffix } = parseCubeToken(token);
  const permutation = CUBE_PERMUTATIONS[face][suffix];
  const result = new Uint8Array(54);
  for (let source = 0; source < 54; source += 1) result[permutation[source]] = state[source];
  return result;
}

function invertCubeAlgorithm(tokens) {
  const parsed = tokens.map(parseCubeToken);
  return parsed.toReversed().map(({ face, suffix }) => (
    CUBE_FACE_NAMES[face] + (suffix === "" ? "'" : suffix === "'" ? "" : "2")
  ));
}

function isCubeSolved(state) {
  validateCubeState(state);
  for (let face = 0; face < 6; face += 1) {
    for (let offset = 0; offset < 9; offset += 1) {
      if (state[face * 9 + offset] !== face) return false;
    }
  }
  return true;
}

function generateCubeScramble(seed, length = 25) {
  const nextUint32 = (() => {
    let value = validateSeed(seed) || 1;
    return () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return value >>>= 0;
    };
  })();
  const scramble = [];
  let previousAxis;
  while (scramble.length < length) {
    const token = CUBE_TOKENS[nextUint32() % CUBE_TOKENS.length];
    if (previousAxis !== undefined && CUBE_AXES[token[0]] === previousAxis) continue;
    scramble.push(token);
    previousAxis = CUBE_AXES[token[0]];
  }
  return scramble;
}

function makeCubeFrame(phase, state, move, index) {
  return { phase, state: Array.from(state), move, index };
}

/** Build the solved -> scramble -> inverse reference replay for a reset. */
export function makeCubeDemo(seed) {
  const normalizedSeed = validateSeed(seed);
  const scramble = generateCubeScramble(normalizedSeed, 25);
  const solution = invertCubeAlgorithm(scramble);
  const frames = [];
  let state = createCubeSolved();
  frames.push(makeCubeFrame("scramble", state, null, 0));
  scramble.forEach((move, index) => {
    state = applyCubeMove(state, move);
    frames.push(makeCubeFrame("scramble", state, move, index + 1));
  });
  solution.forEach((move, index) => {
    state = applyCubeMove(state, move);
    frames.push(makeCubeFrame("solve", state, move, index + 1));
  });
  return { seed: normalizedSeed, scramble, solution, frames, solved: isCubeSolved(state) };
}
