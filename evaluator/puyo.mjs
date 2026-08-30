export const RULES = { width: 6, height: 14, colors: 4, clearThreshold: 4 };

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== RULES.height
    || board.some((row) => !Array.isArray(row) || row.length !== RULES.width)) {
    throw new RangeError("board must be a 14 by 6 array");
  }
  for (const row of board) {
    for (const cell of row) {
      if (!Number.isInteger(cell) || cell < 0 || cell > RULES.colors) {
        throw new RangeError("board cells must be integers from 0 through 4");
      }
    }
  }
}

export function cloneBoard(board) {
  validateBoard(board);
  return board.map((row) => row.slice());
}

export function findGroups(board) {
  validateBoard(board);
  const seen = board.map((row) => row.map(() => false));
  const groups = [];

  for (let y = 0; y < RULES.height; y += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      const color = board[y][x];
      if (color === 0 || seen[y][x]) continue;

      const queue = [[x, y]];
      const cells = [];
      seen[y][x] = true;
      for (let i = 0; i < queue.length; i += 1) {
        const [cx, cy] = queue[i];
        cells.push([cx, cy]);
        for (const [dx, dy] of DIRECTIONS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= RULES.width || ny < 0 || ny >= RULES.height
            || seen[ny][nx] || board[ny][nx] !== color) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      if (cells.length >= RULES.clearThreshold) {
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

export function applyGravity(board) {
  validateBoard(board);
  const result = board.map((row) => row.slice());
  for (let x = 0; x < RULES.width; x += 1) {
    const cells = [];
    for (let y = 0; y < RULES.height; y += 1) {
      if (result[y][x] !== 0) cells.push(result[y][x]);
    }
    for (let y = 0; y < RULES.height; y += 1) result[y][x] = cells[y] ?? 0;
  }
  return result;
}

export function resolve(board) {
  let current = cloneBoard(board);
  const steps = [];

  while (true) {
    const groups = findGroups(current);
    if (groups.length === 0) break;

    const cleared = groups.flatMap(({ cells }) => cells).sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
    for (const [x, y] of cleared) current[y][x] = 0;
    const next = applyGravity(current);
    const boardAfter = next.map((row) => row.slice());
    steps.push({ chain: steps.length + 1, groups, cleared, boardAfter });
    current = next;
  }

  return { finalBoard: current, chainCount: steps.length, steps };
}

function invalidResult(board, reason) {
  return { ok: false, board: board.map((row) => row.slice()), reason };
}

function validPair(pair) {
  return pair && Number.isInteger(pair.x) && Number.isInteger(pair.rotation)
    && pair.rotation >= 0 && pair.rotation <= 3 && Array.isArray(pair.colors)
    && pair.colors.length === 2 && pair.colors.every((color) => Number.isInteger(color)
      && color >= 1 && color <= RULES.colors);
}

export function dropPair(board, pair) {
  let original;
  try {
    original = cloneBoard(board);
  } catch {
    return { ok: false, board: Array.isArray(board) ? board.map((row) => row?.slice?.() ?? row) : board, reason: "invalid" };
  }
  if (!validPair(pair)) return invalidResult(original, "invalid");

  const { x, rotation, colors: [pivotColor, childColor] } = pair;
  const offsets = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const [dx, dy] = offsets[rotation];
  const childX = x + dx;
  if (x < 0 || x >= RULES.width || childX < 0 || childX >= RULES.width) {
    return invalidResult(original, "invalid");
  }

  const result = original.map((row) => row.slice());
  const canPlace = (pivotY) => {
    const childY = pivotY + dy;
    return pivotY >= 0 && pivotY < RULES.height && childY >= 0 && childY < RULES.height
      && result[pivotY][x] === 0 && result[childY][childX] === 0;
  };
  let pivotY = RULES.height - 1 - Math.max(0, dy);
  if (!canPlace(pivotY)) return invalidResult(original, "overflow");
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

function nextRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>>= 0;
  };
}

export function transformChallenge(goal, seed) {
  const next = nextRandom(seed);
  const colors = [1, 2, 3, 4];
  for (let index = colors.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [colors[index], colors[swap]] = [colors[swap], colors[index]];
  }
  const mirror = Boolean(next() & 1);
  const recolor = (cell) => cell === 0 ? 0 : colors[cell - 1];
  const board = cloneBoard(goal.board).map((row) => (mirror ? row.toReversed() : row).map(recolor));
  const pair = {
    x: mirror ? RULES.width - 1 - goal.pair.x : goal.pair.x,
    rotation: mirror && goal.pair.rotation % 2 === 1 ? (goal.pair.rotation === 1 ? 3 : 1) : goal.pair.rotation,
    colors: goal.pair.colors.map(recolor),
  };
  return { board, pair };
}

export function planChallenge(goal, seed = 0) {
  const board = cloneBoard(goal?.board);
  if (!validPair(goal?.pair) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("goal and seed are invalid");
  }
  const columns = Array.from({ length: RULES.width }, (_, x) => board.map((row) => row[x]).filter(Boolean));
  const heights = columns.map((column) => column.length);
  if (heights.reduce((total, height) => total + height, 0) % 2 !== 0) throw new RangeError("goal needs an even cell count");

  const used = Array(RULES.width).fill(0);
  const setupPairs = [];
  let incoming = 0;
  for (let x = 0; x < RULES.width - 1; x += 1) {
    const edge = (heights[x] & 1) ^ incoming;
    if (edge) {
      if (used[x] >= heights[x] || used[x + 1] >= heights[x + 1]) throw new RangeError("goal cannot be paired by adjacent drops");
      setupPairs.push({ x, rotation: 1, colors: [columns[x][used[x]], columns[x + 1][used[x + 1]]] });
      used[x] += 1;
      used[x + 1] += 1;
    }
    incoming = edge;
  }
  if (((heights.at(-1) - used.at(-1)) & 1) !== 0) throw new RangeError("goal cannot be paired by adjacent drops");

  const queues = columns.map((column, x) => {
    const pairs = [];
    for (let y = used[x]; y < column.length; y += 2) {
      if (y + 1 >= column.length) throw new RangeError("goal leaves an unpaired cell");
      pairs.push({ x, rotation: 0, colors: [column[y], column[y + 1]] });
    }
    return pairs;
  });
  const next = nextRandom(seed);
  while (queues.some((queue) => queue.length)) {
    const available = queues.map((queue, x) => queue.length ? x : -1).filter((x) => x >= 0);
    setupPairs.push(queues[available[next() % available.length]].shift());
  }
  return { seed: seed >>> 0, setupPairs, triggerPair: structuredClone(goal.pair) };
}

export default { RULES, cloneBoard, findGroups, applyGravity, resolve, dropPair, transformChallenge, planChallenge };
