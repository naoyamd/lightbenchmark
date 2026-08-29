export const RULES = Object.freeze({
  width: 6,
  height: 14,
  colors: 4,
  clearThreshold: 4,
});

const DIRECTIONS = Object.freeze([
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
]);

const coordOrder = (a, b) => a[1] - b[1] || a[0] - b[0];

function isBoard(board) {
  return Array.isArray(board)
    && board.length === RULES.height
    && board.every((row) => Array.isArray(row)
      && row.length === RULES.width
      && row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= RULES.colors));
}

function copyBoard(board) {
  return board.map((row) => row.slice());
}

function copyInput(board) {
  if (!Array.isArray(board)) return board;
  return board.map((row) => (Array.isArray(row) ? row.slice() : row));
}

function validPair(pair) {
  return pair !== null
    && typeof pair === "object"
    && Number.isInteger(pair.x)
    && Number.isInteger(pair.rotation)
    && pair.rotation >= 0
    && pair.rotation <= 3
    && Array.isArray(pair.colors)
    && pair.colors.length === 2
    && pair.colors.every((color) => Number.isInteger(color) && color >= 1 && color <= RULES.colors);
}

function cellsFor(pair, pivotY) {
  const [dx, dy] = DIRECTIONS[pair.rotation];
  return [
    { x: pair.x, y: pivotY, color: pair.colors[0], pivot: true },
    { x: pair.x + dx, y: pivotY + dy, color: pair.colors[1], pivot: false },
  ];
}

function cellsFit(board, cells) {
  return cells.every(({ x, y }) => (
    x >= 0 && x < RULES.width
    && y >= 0 && y < RULES.height
    && board[y][x] === 0
  ));
}

function settleHorizontalPair(board, cells) {
  for (const cell of cells) {
    let y = cell.y;
    while (y > 0 && board[y - 1][cell.x] === 0) {
      board[y][cell.x] = 0;
      y -= 1;
      board[y][cell.x] = cell.color;
    }
  }
}

export function dropPair(board, pair) {
  const original = copyInput(board);
  if (!isBoard(board) || !validPair(pair)) {
    return { ok: false, board: original, reason: "invalid" };
  }

  const [dx] = DIRECTIONS[pair.rotation];
  if (pair.x < 0 || pair.x >= RULES.width || pair.x + dx < 0 || pair.x + dx >= RULES.width) {
    return { ok: false, board: original, reason: "invalid" };
  }

  const minPivotY = Math.max(0, -DIRECTIONS[pair.rotation][1]);
  const maxPivotY = RULES.height - 1 - Math.max(0, DIRECTIONS[pair.rotation][1]);
  let pivotY = maxPivotY;
  let cells = cellsFor(pair, pivotY);

  // A blocked spawn position cannot be entered from above, even if a lower
  // hole happens to exist.
  if (!cellsFit(board, cells)) {
    return { ok: false, board: original, reason: "overflow" };
  }

  while (pivotY > minPivotY) {
    const next = cellsFor(pair, pivotY - 1);
    if (!cellsFit(board, next)) break;
    pivotY -= 1;
    cells = next;
  }

  const result = copyBoard(board);
  for (const cell of cells) result[cell.y][cell.x] = cell.color;

  // A horizontal pair can touch down on one side first.  Once locked, the
  // unsupported half continues down its own column.
  if (pair.rotation === 1 || pair.rotation === 3) {
    settleHorizontalPair(result, cells);
  }

  return { ok: true, board: result };
}

function findGroups(board) {
  const seen = Array.from({ length: RULES.height }, () => Array(RULES.width).fill(false));
  const groups = [];

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
        for (const [mx, my] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const nx = cx + mx;
          const ny = cy + my;
          if (nx < 0 || nx >= RULES.width || ny < 0 || ny >= RULES.height) continue;
          if (seen[ny][nx] || board[ny][nx] !== color) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }

      cells.sort(coordOrder);
      if (cells.length >= RULES.clearThreshold) groups.push({ color, cells });
    }
  }

  groups.sort((a, b) => coordOrder(a.cells[0], b.cells[0]) || a.color - b.color);
  return groups;
}

function applyGravity(board) {
  for (let x = 0; x < RULES.width; x += 1) {
    let writeY = 0;
    for (let y = 0; y < RULES.height; y += 1) {
      if (board[y][x] === 0) continue;
      board[writeY][x] = board[y][x];
      if (writeY !== y) board[y][x] = 0;
      writeY += 1;
    }
    while (writeY < RULES.height) {
      board[writeY][x] = 0;
      writeY += 1;
    }
  }
}

export function resolve(board) {
  if (!isBoard(board)) throw new TypeError("invalid board");

  let current = copyBoard(board);
  const steps = [];
  let chain = 0;

  while (true) {
    const groups = findGroups(current);
    if (groups.length === 0) break;
    chain += 1;

    const cleared = groups.flatMap((group) => group.cells.map(([x, y]) => [x, y]));
    cleared.sort(coordOrder);
    const next = copyBoard(current);
    for (const [x, y] of cleared) next[y][x] = 0;
    applyGravity(next);

    steps.push({
      chain,
      groups: groups.map((group) => ({
        color: group.color,
        cells: group.cells.map(([x, y]) => [x, y]),
      })),
      cleared: cleared.map(([x, y]) => [x, y]),
      boardAfter: copyBoard(next),
    });
    current = next;
  }

  return {
    finalBoard: copyBoard(current),
    chainCount: chain,
    steps,
  };
}
