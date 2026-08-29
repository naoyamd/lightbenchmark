export const RULES = Object.freeze({
  width: 6,
  height: 14,
  colors: 4,
  clearThreshold: 4,
});

function copyBoard(board) {
  if (!Array.isArray(board)) return [];
  return board.map((row) => (Array.isArray(row) ? row.slice() : row));
}

function validBoard(board) {
  return Array.isArray(board)
    && board.length === RULES.height
    && board.every((row) => Array.isArray(row)
      && row.length === RULES.width
      && row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= RULES.colors));
}

function pairShape(pair) {
  if (!pair || !Number.isInteger(pair.x) || !Number.isInteger(pair.rotation)
    || pair.rotation < 0 || pair.rotation > 3
    || !Array.isArray(pair.colors) || pair.colors.length !== 2
    || !pair.colors.every((color) => Number.isInteger(color) && color >= 1 && color <= RULES.colors)) {
    return null;
  }
  const rotation = pair.rotation;
  const offsets = [
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, -1]],
    [[0, 0], [-1, 0]],
  ][rotation];
  return { x: pair.x, rotation, colors: pair.colors.slice(), offsets };
}

function canOccupy(board, shape, pivotY) {
  for (const [dx, dy] of shape.offsets) {
    const x = shape.x + dx;
    const y = pivotY + dy;
    if (x < 0 || x >= RULES.width || y < 0) return false;
    if (y < RULES.height && board[y][x] !== 0) return false;
  }
  return true;
}

function settle(board) {
  for (let x = 0; x < RULES.width; x += 1) {
    const column = [];
    for (let y = 0; y < RULES.height; y += 1) {
      if (board[y][x] !== 0) column.push(board[y][x]);
    }
    for (let y = 0; y < RULES.height; y += 1) {
      board[y][x] = column[y] ?? 0;
    }
  }
  return board;
}

/**
 * Drop a rigid two-puyo pair, then settle the two columns independently.
 * The input board is never changed.
 */
export function dropPair(board, pair) {
  const original = copyBoard(board);
  if (!validBoard(board)) return { ok: false, board: original, reason: "invalid" };
  const shape = pairShape(pair);
  if (!shape) return { ok: false, board: original, reason: "invalid" };

  // Begin just above the well. Cells above the rim are allowed while falling,
  // but a pair may only lock once both halves are inside the well.
  let pivotY = RULES.height + 1;
  while (canOccupy(board, shape, pivotY - 1)) pivotY -= 1;

  const finalCells = shape.offsets.map(([dx, dy]) => [shape.x + dx, pivotY + dy]);
  if (finalCells.some(([x, y]) => x < 0 || x >= RULES.width || y < 0 || y >= RULES.height)) {
    return { ok: false, board: original, reason: "overflow" };
  }
  if (!canOccupy(board, shape, pivotY)) {
    return { ok: false, board: original, reason: "overflow" };
  }

  const result = copyBoard(board);
  finalCells.forEach(([x, y], index) => {
    result[y][x] = shape.colors[index];
  });
  settle(result);
  return { ok: true, board: result };
}

function groupsOn(board) {
  const seen = Array.from({ length: RULES.height }, () => Array(RULES.width).fill(false));
  const groups = [];
  const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  for (let y = 0; y < RULES.height; y += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      if (seen[y][x] || board[y][x] === 0) continue;
      const color = board[y][x];
      const queue = [[x, y]];
      const cells = [];
      seen[y][x] = true;
      for (let index = 0; index < queue.length; index += 1) {
        const [cx, cy] = queue[index];
        cells.push([cx, cy]);
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < RULES.width && ny >= 0 && ny < RULES.height
            && !seen[ny][nx] && board[ny][nx] === color) {
            seen[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
      }
      if (cells.length >= RULES.clearThreshold) {
        cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        groups.push({ color, cells });
      }
    }
  }
  return groups;
}

function sortedCells(groups) {
  return groups.flatMap((group) => group.cells.map(([x, y]) => [x, y]))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function resolve(board) {
  const work = validBoard(board) ? copyBoard(board) : [];
  const steps = [];
  if (!validBoard(board)) return { finalBoard: work, chainCount: 0, steps };

  let chainCount = 0;
  while (true) {
    const groups = groupsOn(work);
    if (groups.length === 0) break;
    const cleared = sortedCells(groups);
    for (const [x, y] of cleared) work[y][x] = 0;
    settle(work);
    chainCount += 1;
    steps.push({
      chain: chainCount,
      groups: groups.map((group) => ({
        color: group.color,
        cells: group.cells.map(([x, y]) => [x, y]),
      })),
      cleared: cleared.map(([x, y]) => [x, y]),
      boardAfter: copyBoard(work),
    });
  }

  return { finalBoard: copyBoard(work), chainCount, steps };
}
