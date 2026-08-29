export const RULES = Object.freeze({
  width: 6,
  height: 14,
  colors: 4,
  clearThreshold: 4,
});

const cloneBoard = (board) => board.map((row) => row.slice());
const cloneInput = (board) => Array.isArray(board)
  ? board.map((row) => Array.isArray(row) ? row.slice() : row)
  : board;

function isValidBoard(board) {
  return Array.isArray(board)
    && board.length === RULES.height
    && board.every((row) => Array.isArray(row)
      && row.length === RULES.width
      && row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= RULES.colors));
}

function compact(board) {
  for (let x = 0; x < RULES.width; x += 1) {
    const filled = [];
    for (let y = 0; y < RULES.height; y += 1) {
      if (board[y][x] !== 0) filled.push(board[y][x]);
    }
    for (let y = 0; y < RULES.height; y += 1) board[y][x] = filled[y] ?? 0;
  }
  return board;
}

function validPair(pair) {
  return pair && Number.isInteger(pair.x)
    && Number.isInteger(pair.rotation) && pair.rotation >= 0 && pair.rotation <= 3
    && Array.isArray(pair.colors) && pair.colors.length === 2
    && pair.colors.every((color) => Number.isInteger(color) && color >= 1 && color <= RULES.colors);
}

export function dropPair(board, pair) {
  if (!isValidBoard(board) || !validPair(pair)) {
    return { ok: false, board: cloneInput(board), reason: "invalid" };
  }

  const result = cloneBoard(board);
  const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const [dx, dy] = directions[pair.rotation];
  const childX = pair.x + dx;
  if (pair.x < 0 || pair.x >= RULES.width || childX < 0 || childX >= RULES.width) {
    return { ok: false, board: cloneBoard(board), reason: "invalid" };
  }

  // Start above the well and move the rigid pair one row at a time. Keeping
  // the simulation explicit makes floor, side walls, and uneven columns agree.
  let pivotY = RULES.height + 1;
  let locked = false;
  while (!locked) {
    const nextY = pivotY - 1;
    const nextCells = [[pair.x, nextY], [childX, nextY + dy]];
    locked = nextCells.some(([x, y]) => y < 0
      || (y < RULES.height && result[y][x] !== 0));
    if (!locked) pivotY -= 1;
    if (pivotY < -2) break;
  }

  const cells = [[pair.x, pivotY], [childX, pivotY + dy]];
  if (cells.some(([x, y]) => y < 0 || y >= RULES.height || result[y][x] !== 0)) {
    return { ok: false, board: cloneBoard(board), reason: "overflow" };
  }

  result[cells[0][1]][cells[0][0]] = pair.colors[0];
  result[cells[1][1]][cells[1][0]] = pair.colors[1];
  // Horizontal pairs can stop with one half above a shorter column. Ordinary
  // column gravity then drops only the unsupported half (and preserves order).
  compact(result);
  return { ok: true, board: result };
}

function findGroups(board) {
  const seen = Array.from({ length: RULES.height }, () => Array(RULES.width).fill(false));
  const groups = [];
  const neighbors = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  for (let y = 0; y < RULES.height; y += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      if (seen[y][x] || board[y][x] === 0) continue;
      const color = board[y][x];
      const queue = [[x, y]];
      const cells = [];
      seen[y][x] = true;
      for (let head = 0; head < queue.length; head += 1) {
        const [cx, cy] = queue[head];
        cells.push([cx, cy]);
        for (const [ox, oy] of neighbors) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || nx >= RULES.width || ny < 0 || ny >= RULES.height
            || seen[ny][nx] || board[ny][nx] !== color) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      if (cells.length >= RULES.clearThreshold) {
        cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        groups.push({ color, cells });
      }
    }
  }
  groups.sort((a, b) => a.cells[0][1] - b.cells[0][1]
    || a.cells[0][0] - b.cells[0][0] || a.color - b.color);
  return groups;
}

export function resolve(board) {
  if (!isValidBoard(board)) return { finalBoard: [], chainCount: 0, steps: [] };
  const current = cloneBoard(board);
  const steps = [];
  let chainCount = 0;
  while (true) {
    const groups = findGroups(current);
    if (groups.length === 0) break;
    const cleared = groups.flatMap((group) => group.cells.map(([x, y]) => [x, y]));
    cleared.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [x, y] of cleared) current[y][x] = 0;
    compact(current);
    chainCount += 1;
    steps.push({
      chain: chainCount,
      groups: groups.map((group) => ({ color: group.color, cells: group.cells.map(([x, y]) => [x, y]) })),
      cleared: cleared.map(([x, y]) => [x, y]),
      boardAfter: cloneBoard(current),
    });
  }
  return { finalBoard: cloneBoard(current), chainCount, steps };
}
