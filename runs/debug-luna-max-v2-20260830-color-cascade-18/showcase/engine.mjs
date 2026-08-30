export const RULES = Object.freeze({
  width: 6,
  height: 14,
  colors: 4,
  clearThreshold: 4,
});

const { width: W, height: H, colors: COLOR_COUNT, clearThreshold: CLEAR } = RULES;

function copyBoard(board) {
  return board.map(row => row.slice());
}

function validBoard(board) {
  return Array.isArray(board) && board.length === H && board.every(row =>
    Array.isArray(row) && row.length === W && row.every(cell => Number.isInteger(cell) && cell >= 0 && cell <= COLOR_COUNT)
  );
}

function validPair(pair) {
  return pair && typeof pair === "object" && Number.isInteger(pair.x) && pair.x >= 0 && pair.x < W &&
    Number.isInteger(pair.rotation) && pair.rotation >= 0 && pair.rotation < 4 &&
    Array.isArray(pair.colors) && pair.colors.length === 2 &&
    pair.colors.every(color => Number.isInteger(color) && color >= 1 && color <= COLOR_COUNT);
}

function shape(pair, pivotY) {
  // The pivot is the first color.  y=0 is the floor.
  if (pair.rotation === 0) return [{ x: pair.x, y: pivotY }, { x: pair.x, y: pivotY + 1 }];
  if (pair.rotation === 1) return [{ x: pair.x, y: pivotY }, { x: pair.x + 1, y: pivotY }];
  if (pair.rotation === 2) return [{ x: pair.x, y: pivotY }, { x: pair.x, y: pivotY - 1 }];
  return [{ x: pair.x, y: pivotY }, { x: pair.x - 1, y: pivotY }];
}

function canOccupy(board, cells) {
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= W || cell.y < 0) return false;
    if (cell.y < H && board[cell.y][cell.x] !== 0) return false;
  }
  return true;
}

function settleHalf(board, x, y) {
  while (y - 1 >= 0 && (y - 1 >= H || board[y - 1][x] === 0)) y -= 1;
  return y;
}

export function dropPair(board, pair) {
  const safeBoard = validBoard(board) ? copyBoard(board) : [];
  if (!validBoard(board) || !validPair(pair)) return { ok: false, board: safeBoard, reason: "invalid" };

  // Start above the field and let the rigid pair descend one row at a time.
  let pivotY = H + 2;
  while (canOccupy(board, shape(pair, pivotY - 1))) pivotY -= 1;
  const landed = shape(pair, pivotY);

  let finalCells;
  if (pair.rotation === 1 || pair.rotation === 3) {
    // Once a horizontal pair touches down, each unsupported half continues in
    // its own column.  The columns are distinct, so these falls are independent.
    finalCells = landed.map(cell => ({ x: cell.x, y: settleHalf(board, cell.x, cell.y) }));
  } else {
    finalCells = landed;
  }

  if (!finalCells.every(cell => cell.y >= 0 && cell.y < H && board[cell.y][cell.x] === 0)) {
    return { ok: false, board: safeBoard, reason: "overflow" };
  }

  const result = copyBoard(board);
  result[finalCells[0].y][finalCells[0].x] = pair.colors[0];
  result[finalCells[1].y][finalCells[1].x] = pair.colors[1];
  return { ok: true, board: result };
}

function clearGroups(board) {
  const visited = Array.from({ length: H }, () => Array(W).fill(false));
  const groups = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (visited[y][x] || board[y][x] === 0) continue;
      const color = board[y][x];
      const queue = [[x, y]];
      const cells = [];
      visited[y][x] = true;
      for (let head = 0; head < queue.length; head += 1) {
        const [cx, cy] = queue[head];
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || visited[ny][nx] || board[ny][nx] !== color) continue;
          visited[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      if (cells.length >= CLEAR) {
        cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        groups.push({ color, cells });
      }
    }
  }
  groups.sort((a, b) => a.cells[0][1] - b.cells[0][1] || a.cells[0][0] - b.cells[0][0] || a.color - b.color);
  return groups;
}

function applyGravity(board) {
  const result = copyBoard(board);
  for (let x = 0; x < W; x += 1) {
    const column = [];
    for (let y = 0; y < H; y += 1) if (result[y][x] !== 0) column.push(result[y][x]);
    for (let y = 0; y < H; y += 1) result[y][x] = column[y] ?? 0;
  }
  return result;
}

export function resolve(board) {
  const current = validBoard(board) ? copyBoard(board) : [];
  if (!validBoard(board)) return { finalBoard: current, chainCount: 0, steps: [] };

  let working = current;
  let chainCount = 0;
  const steps = [];
  while (true) {
    const groups = clearGroups(working);
    if (groups.length === 0) break;
    chainCount += 1;
    const cleared = groups.flatMap(group => group.cells.map(cell => [cell[0], cell[1]]));
    cleared.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const afterClear = copyBoard(working);
    for (const [x, y] of cleared) afterClear[y][x] = 0;
    working = applyGravity(afterClear);
    steps.push({
      chain: chainCount,
      groups: groups.map(group => ({ color: group.color, cells: group.cells.map(cell => [cell[0], cell[1]]) })),
      cleared: cleared.map(cell => [cell[0], cell[1]]),
      boardAfter: copyBoard(working),
    });
  }
  return { finalBoard: copyBoard(working), chainCount, steps };
}

function compactHeights(board) {
  const heights = [];
  for (let x = 0; x < W; x += 1) {
    let height = 0;
    while (height < H && board[height][x] !== 0) height += 1;
    for (let y = height; y < H; y += 1) if (board[y][x] !== 0) return null;
    heights.push(height);
  }
  return heights;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function sameBoard(a, b) {
  return validBoard(a) && validBoard(b) && a.every((row, y) => row.every((cell, x) => cell === b[y][x]));
}

function scheduleForGoal(board, heights, seed) {
  // On a line of columns, the minimal horizontal edges are the positions
  // where the running column-height parity is odd.  Every other cell is a
  // vertical pair.  This is a general decomposition, not a goal-specific list.
  const horizontalEdges = [];
  let parity = 0;
  for (let x = 0; x < W - 1; x += 1) {
    parity ^= heights[x] & 1;
    if (parity) horizontalEdges.push(x);
  }
  if ((heights.reduce((sum, height) => sum + height, 0) & 1) !== 0) return null;

  const degree = Array(W).fill(0);
  for (const edge of horizontalEdges) {
    degree[edge] += 1;
    degree[edge + 1] += 1;
  }
  if (degree.some((value, x) => value > heights[x] || ((heights[x] - value) & 1))) return null;

  const random = seededRandom(seed);
  const counts = Array(W).fill(0);
  let usedMask = 0;
  const operations = [];
  const total = heights.reduce((sum, height) => sum + height, 0) / 2;

  const feasible = (nextCounts, nextMask) => {
    const remainingDegree = Array(W).fill(0);
    horizontalEdges.forEach((edge, index) => {
      if (!(nextMask & (1 << index))) {
        remainingDegree[edge] += 1;
        remainingDegree[edge + 1] += 1;
      }
    });
    return heights.every((height, x) => {
      const remaining = height - nextCounts[x] - remainingDegree[x];
      return remaining >= 0 && (remaining & 1) === 0;
    });
  };

  while (operations.length < total) {
    const candidates = [];
    for (let x = 0; x < W; x += 1) {
      if (counts[x] + 2 <= heights[x]) {
        const next = counts.slice();
        next[x] += 2;
        if (feasible(next, usedMask)) candidates.push({ kind: "v", x, next, mask: usedMask });
      }
    }
    for (let index = 0; index < horizontalEdges.length; index += 1) {
      if (usedMask & (1 << index)) continue;
      const x = horizontalEdges[index];
      if (counts[x] >= heights[x] || counts[x + 1] >= heights[x + 1]) continue;
      const next = counts.slice();
      next[x] += 1;
      next[x + 1] += 1;
      const nextMask = usedMask | (1 << index);
      if (feasible(next, nextMask)) candidates.push({ kind: "h", x, index, next, mask: nextMask });
    }
    if (candidates.length === 0) return null;
    // A seeded rotation plus a seeded shuffle gives visibly different but
    // reproducible legal build orders for different seeds.
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const chosen = candidates[0];
    const y = counts[chosen.x];
    if (chosen.kind === "v") {
      operations.push({ x: chosen.x, rotation: 0, colors: [board[y][chosen.x], board[y + 1][chosen.x]] });
    } else {
      const rightY = counts[chosen.x + 1];
      operations.push({ x: chosen.x, rotation: 1, colors: [board[y][chosen.x], board[rightY][chosen.x + 1]] });
    }
    counts.splice(0, W, ...chosen.next);
    usedMask = chosen.mask;
  }
  return operations;
}

export function planChallenge(goal, seed) {
  const board = goal?.board;
  const triggerPair = goal?.pair;
  if (!validBoard(board) || !validPair(triggerPair)) throw new TypeError("invalid goal");
  const safeGoal = copyBoard(board);
  const heights = compactHeights(safeGoal);
  if (!heights) throw new TypeError("goal must have compact columns");
  const setupPairs = scheduleForGoal(safeGoal, heights, seed >>> 0);
  if (!setupPairs || setupPairs.length !== 35) throw new TypeError("goal cannot be paired");

  // Keep the planner honest for callers using transformed goals: verify the
  // generated real inputs, rather than trusting the arithmetic decomposition.
  let working = Array.from({ length: H }, () => Array(W).fill(0));
  for (const pair of setupPairs) {
    const dropped = dropPair(working, pair);
    if (!dropped.ok || resolve(dropped.board).chainCount !== 0) throw new Error("planner produced an illegal setup");
    working = dropped.board;
  }
  if (!sameBoard(working, safeGoal)) throw new Error("planner did not reach goal");

  return {
    seed: seed >>> 0,
    setupPairs: setupPairs.map(pair => ({ x: pair.x, rotation: pair.rotation, colors: pair.colors.slice() })),
    triggerPair: { x: triggerPair.x, rotation: triggerPair.rotation, colors: triggerPair.colors.slice() },
  };
}
