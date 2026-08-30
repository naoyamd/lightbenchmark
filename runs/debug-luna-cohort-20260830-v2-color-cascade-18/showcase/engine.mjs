export const RULES = Object.freeze({
  width: 6,
  height: 14,
  colors: 4,
  clearThreshold: 4,
});

const isInteger = value => Number.isInteger(value);

function copyBoard(board) {
  return Array.isArray(board) ? board.map(row => Array.isArray(row) ? row.slice() : row) : board;
}

function validBoard(board) {
  return Array.isArray(board)
    && board.length === RULES.height
    && board.every(row => Array.isArray(row)
      && row.length === RULES.width
      && row.every(cell => isInteger(cell) && cell >= 0 && cell <= RULES.colors));
}

function validPair(pair) {
  return pair && typeof pair === 'object'
    && isInteger(pair.x)
    && isInteger(pair.rotation)
    && pair.rotation >= 0
    && pair.rotation <= 3
    && Array.isArray(pair.colors)
    && pair.colors.length === 2
    && pair.colors.every(color => isInteger(color) && color >= 1 && color <= RULES.colors);
}

function failBoard(board, reason) {
  return { ok: false, board: copyBoard(board), reason };
}

function supports(board, x, y) {
  return y === 0 || board[y - 1]?.[x] !== 0;
}

/**
 * Drops a two-cell pair into a copy of board. y=0 is the floor.
 * A horizontal pair locks when either column is reached, then the
 * unsupported half settles independently in its own column.
 */
export function dropPair(board, pair) {
  if (!validBoard(board) || !validPair(pair)) return failBoard(board, 'invalid');

  const result = copyBoard(board);
  const { x, rotation, colors } = pair;
  const cells = rotation === 0
    ? [{ x, dy: 0, color: colors[0] }, { x, dy: 1, color: colors[1] }]
    : rotation === 1
      ? [{ x, dy: 0, color: colors[0] }, { x: x + 1, dy: 0, color: colors[1] }]
      : rotation === 2
        ? [{ x, dy: 1, color: colors[0] }, { x, dy: 0, color: colors[1] }]
        : [{ x: x - 1, dy: 0, color: colors[1] }, { x, dy: 0, color: colors[0] }];

  if (cells.some(cell => cell.x < 0 || cell.x >= RULES.width)) return failBoard(board, 'invalid');

  const heights = cells.map(cell => {
    let height = 0;
    while (height < RULES.height && result[height][cell.x] !== 0) height += 1;
    return height;
  });

  if (cells.some((cell, index) => heights[index] >= RULES.height)) return failBoard(board, 'overflow');

  if (rotation === 0 || rotation === 2) {
    const column = cells[0].x;
    const base = heights[0];
    if (base + 1 >= RULES.height) return failBoard(board, 'overflow');
    // cells is ordered by the pivot first for both vertical rotations.
    for (const cell of cells) result[base + cell.dy][column] = cell.color;
    return { ok: true, board: result };
  }

  // The pair travels as a rigid horizontal shape until the taller column
  // is touched. The other half then falls to the top of its own stack.
  const rest = Math.max(...heights);
  if (rest >= RULES.height) return failBoard(board, 'overflow');
  for (const cell of cells) {
    const y = heights[cells.indexOf(cell)];
    if (y >= RULES.height) return failBoard(board, 'overflow');
    result[y][cell.x] = cell.color;
  }
  return { ok: true, board: result };
}

function sortedCells(cells) {
  return cells
    .map(([x, y]) => [x, y])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function findGroups(board) {
  const seen = Array.from({ length: RULES.height }, () => Array(RULES.width).fill(false));
  const groups = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < RULES.height; y += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      const color = board[y][x];
      if (color === 0 || seen[y][x]) continue;
      const queue = [[x, y]];
      const cells = [];
      seen[y][x] = true;
      for (let index = 0; index < queue.length; index += 1) {
        const [cx, cy] = queue[index];
        cells.push([cx, cy]);
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= RULES.width || ny < 0 || ny >= RULES.height
            || seen[ny][nx] || board[ny][nx] !== color) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      if (cells.length >= RULES.clearThreshold) {
        groups.push({ color, cells: sortedCells(cells) });
      }
    }
  }
  return groups.sort((a, b) => {
    const firstA = a.cells[0];
    const firstB = b.cells[0];
    return firstA[1] - firstB[1] || firstA[0] - firstB[0] || a.color - b.color;
  });
}

function settle(board) {
  const result = copyBoard(board);
  for (let x = 0; x < RULES.width; x += 1) {
    const filled = [];
    for (let y = 0; y < RULES.height; y += 1) {
      if (result[y][x] !== 0) filled.push(result[y][x]);
    }
    for (let y = 0; y < RULES.height; y += 1) result[y][x] = filled[y] ?? 0;
  }
  return result;
}

export function resolve(board) {
  if (!validBoard(board)) {
    return { finalBoard: copyBoard(board), chainCount: 0, steps: [] };
  }

  let current = copyBoard(board);
  const steps = [];
  let chain = 0;

  while (true) {
    const groups = findGroups(current);
    if (groups.length === 0) break;
    chain += 1;
    const cleared = sortedCells(groups.flatMap(group => group.cells));
    const next = copyBoard(current);
    for (const [x, y] of cleared) next[y][x] = 0;
    const boardAfter = settle(next);
    steps.push({
      chain,
      groups: groups.map(group => ({ color: group.color, cells: sortedCells(group.cells) })),
      cleared,
      boardAfter: copyBoard(boardAfter),
    });
    current = boardAfter;
  }

  return { finalBoard: copyBoard(current), chainCount: chain, steps };
}
