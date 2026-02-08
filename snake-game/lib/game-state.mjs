/**
 * Game state utilities and hex grid helpers
 */

// Hex directions and their offsets (flat-top hexagonal grid, axial coordinates)
export const HEX_DIRECTIONS = {
  n:  { q:  0, r: -1 },
  ne: { q:  1, r: -1 },
  se: { q:  1, r:  0 },
  s:  { q:  0, r:  1 },
  sw: { q: -1, r:  1 },
  nw: { q: -1, r:  0 },
};

export const OPPOSITE_DIRECTIONS = {
  n: 's', s: 'n',
  ne: 'sw', sw: 'ne',
  se: 'nw', nw: 'se',
};

export const ALL_DIRECTIONS = Object.keys(HEX_DIRECTIONS);

/**
 * Check if coordinates are within hex grid bounds
 */
export function isInBounds(q, r, radius) {
  return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
}

/**
 * Check if a position is on the snake body
 */
export function isOnSnakeBody(q, r, snakeBody) {
  return snakeBody.some(seg => seg.q === q && seg.r === r);
}

/**
 * Calculate hex distance between two points in axial coordinates
 * Uses cube coordinate conversion: for axial (q, r), cube is (q, r, -q-r)
 * Distance = max(|dq|, |dr|, |dq + dr|) where dq = q1 - q2, dr = r1 - r2
 */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  // In cube coordinates: dz = -dq - dr
  // Distance is max(|dx|, |dy|, |dz|) = max(|dq|, |dr|, |dq + dr|)
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/**
 * Get all valid directions the snake can move
 */
export function getValidDirections(gameState) {
  if (!gameState?.snake?.body) return [];

  const head = gameState.snake.body[0];
  const radius = gameState.gridSize?.radius || 3;
  const valid = [];

  for (const [dir, offset] of Object.entries(HEX_DIRECTIONS)) {
    const newQ = head.q + offset.q;
    const newR = head.r + offset.r;

    // Check bounds
    if (!isInBounds(newQ, newR, radius)) continue;

    // Check self-collision (skip head, check rest of body)
    if (isOnSnakeBody(newQ, newR, gameState.snake.body.slice(1))) continue;

    valid.push(dir);
  }

  return valid;
}

/**
 * Find the closest fruit for a team
 */
export function findClosestFruit(head, fruits, teamId) {
  const teamFruits = fruits[teamId] || [];
  if (teamFruits.length === 0) return null;

  let closest = null;
  let minDist = Infinity;

  for (const fruit of teamFruits) {
    const dist = hexDistance(head, fruit);
    if (dist < minDist) {
      minDist = dist;
      closest = fruit;
    }
  }

  return { fruit: closest, distance: minDist };
}

/**
 * Get the best direction toward a target
 */
export function bestDirectionToward(head, target, validDirs) {
  let bestDir = null;
  let bestDist = Infinity;

  for (const dir of validDirs) {
    const offset = HEX_DIRECTIONS[dir];
    const newPos = { q: head.q + offset.q, r: head.r + offset.r };
    const dist = hexDistance(newPos, target);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }

  return bestDir;
}

/**
 * Count exits from a position (safety metric)
 */
export function countExits(pos, gameState, excludeDir = null) {
  const radius = gameState.gridSize?.radius || 3;
  const snakeBody = gameState.snake?.body || [];
  let exits = 0;

  for (const [dir, offset] of Object.entries(HEX_DIRECTIONS)) {
    if (excludeDir && dir === excludeDir) continue;

    const newQ = pos.q + offset.q;
    const newR = pos.r + offset.r;

    if (!isInBounds(newQ, newR, radius)) continue;
    if (isOnSnakeBody(newQ, newR, snakeBody)) continue;

    exits++;
  }

  return exits;
}

/**
 * Parse game state into a more usable format
 */
export function parseGameState(gs) {
  if (!gs || gs.error) return null;

  const head = gs.snake?.body?.[0];
  if (!head) return null;

  const teams = (gs.teams || []).map(team => ({
    ...team,
    score: gs.fruitScores?.[team.id] || 0,
    pool: gs.teamPools?.[team.id] || 0,
    closestFruit: findClosestFruit(head, gs.apples || {}, team.id),
  }));

  return {
    active: gs.gameActive,
    round: gs.round,
    prizePool: gs.prizePool || 10,
    minBid: gs.minBid || 1,
    countdown: gs.countdown,
    fruitsToWin: gs.config?.fruitsToWin || 3,
    gridRadius: gs.gridSize?.radius || 3,
    head,
    snakeLength: gs.snake?.body?.length || 0,
    currentDirection: gs.snake?.currentDirection,
    currentWinningTeam: gs.snake?.currentWinningTeam,
    teams,
    validDirections: getValidDirections(gs),
    votes: gs.votes || {},
    winner: gs.winner,
    raw: gs,
  };
}

/**
 * Get team by ID
 */
export function getTeamById(parsed, teamId) {
  return parsed?.teams?.find(t => t.id === teamId);
}
