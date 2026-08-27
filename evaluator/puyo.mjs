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

export default { RULES, cloneBoard, findGroups, applyGravity, resolve, dropPair };
