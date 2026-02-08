/**
 * Expected Value Strategy
 *
 * Maximizes expected value: P(win) * payout
 * - Balances win probability with payout potential
 * - Switches teams when another has significantly better EV
 * - Avoids dead-ends and unsafe positions
 */

import { BaseStrategy } from './base.mjs';
import {
  HEX_DIRECTIONS,
  OPPOSITE_DIRECTIONS,
  hexDistance,
  countExits,
} from '../game-state.mjs';

export class ExpectedValueStrategy extends BaseStrategy {
  constructor(options = {}) {
    super(
      'expected-value',
      'Maximizes expected value (win probability * payout). Balanced approach.',
      options
    );
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    const analysis = this.analyzeTeams(parsed, state.currentTeam);

    // Determine if we should play this round
    if (!analysis.shouldPlay) {
      return { skip: true, reason: analysis.reason };
    }

    const targetTeam = analysis.recommendedTeam;
    const targetFruit = targetTeam.closestFruit?.fruit;
    const fruitDist = targetTeam.closestFruit?.distance ?? '?';

    // Score all valid directions
    const dirScores = parsed.validDirections.map(dir => ({
      dir,
      score: this.scoreDirection(dir, parsed, targetFruit),
    })).sort((a, b) => b.score - a.score);

    const bestDir = dirScores[0]?.dir;
    if (!bestDir) return null;

    // Calculate distance after moving in best direction
    let newDist = '?';
    if (targetFruit) {
      const offset = HEX_DIRECTIONS[bestDir];
      const newPos = {
        q: parsed.head.q + offset.q,
        r: parsed.head.r + offset.r,
      };
      newDist = hexDistance(newPos, targetFruit);
    }

    // Determine bid amount
    const bidAmount = this.calculateBid(parsed, balance, bestDir, targetTeam);

    // Include distance info in reason for debugging
    const distInfo = `d:${fruitDist}→${newDist}`;

    return {
      direction: bestDir,
      team: targetTeam,
      amount: bidAmount,
      reason: `${analysis.reason} ${distInfo}`,
      analysis: {
        teamEV: analysis.teamEV,
        dirScore: dirScores[0].score,
      },
    };
  }

  analyzeTeams(parsed, currentTeamId, ourContribution = 0) {
    const minEV = this.getOption('minExpectedValue', 0.1);
    const switchThreshold = this.getOption('switchThreshold', 3.0); // Much higher - switching loses existing stake

    // Calculate EV for each team (only teams with fruits can be targeted)
    const teamStats = parsed.teams
      .filter(team => team.closestFruit !== null) // Must have fruit to target
      .map(team => {
        const isCurrentTeam = team.id === currentTeamId;
        const ev = this.calculateExpectedValue(team, parsed, isCurrentTeam);
        return { team, ev, isCurrentTeam };
      });

    // If no teams have fruits, skip
    if (teamStats.length === 0) {
      return {
        shouldPlay: false,
        recommendedTeam: null,
        reason: 'no_teams_with_fruits',
        teamEV: 0,
      };
    }

    // Sort by EV
    teamStats.sort((a, b) => b.ev - a.ev);

    const bestTeam = teamStats[0];
    const currentTeam = teamStats.find(t => t.team.id === currentTeamId);

    // Early game - just join the team closest to winning
    if (!currentTeamId) {
      // Prefer team with highest score, then closest fruit
      const bestByScore = [...teamStats].sort((a, b) => {
        if (b.team.score !== a.team.score) return b.team.score - a.team.score;
        return (a.team.closestFruit?.distance ?? 100) - (b.team.closestFruit?.distance ?? 100);
      })[0];

      return {
        shouldPlay: true,
        recommendedTeam: bestByScore.team,
        reason: `joining (score:${bestByScore.team.score}, dist:${bestByScore.team.closestFruit?.distance ?? '?'})`,
        teamEV: bestByScore.ev,
      };
    }

    // CRITICAL: If we have stake in current team, strongly prefer staying
    // Switching teams means we LOSE our existing stake completely
    if (currentTeam) {
      const currentPool = currentTeam.team.pool || 0;

      // If we're the majority of our team's pool, we have huge incentive to stay
      // The only reason to switch is if current team literally cannot win
      const currentFruitsNeeded = parsed.fruitsToWin - currentTeam.team.score;
      const currentDist = currentTeam.team.closestFruit?.distance ?? 100;

      // Stay with current team if it can still win
      if (currentFruitsNeeded > 0 && currentTeam.team.closestFruit) {
        return {
          shouldPlay: true,
          recommendedTeam: currentTeam.team,
          reason: `loyal (need:${currentFruitsNeeded}, dist:${currentDist}, pool:${currentPool.toFixed(0)})`,
          teamEV: currentTeam.ev,
        };
      }

      // Current team has no path to victory - consider switching
      if (!currentTeam.team.closestFruit || currentFruitsNeeded <= 0) {
        return {
          shouldPlay: true,
          recommendedTeam: bestTeam.team,
          reason: `switching (current team blocked)`,
          teamEV: bestTeam.ev,
        };
      }
    }

    // Fallback: pick best team
    return {
      shouldPlay: true,
      recommendedTeam: bestTeam.team,
      reason: 'best_available',
      teamEV: bestTeam.ev,
    };
  }

  calculateExpectedValue(team, parsed, isCurrentTeam = false) {
    const fruitsNeeded = parsed.fruitsToWin - team.score;
    const fruitDist = team.closestFruit?.distance ?? 10;
    const pool = team.pool || 0;
    const prizePool = parsed.prizePool;

    // Estimate win probability based on score and distance
    let winProb = 0;
    if (fruitsNeeded <= 0) {
      winProb = 0; // Already won (shouldn't happen mid-game)
    } else if (fruitsNeeded === 1 && fruitDist <= 1) {
      winProb = 0.9; // Very close to winning
    } else if (fruitsNeeded === 1 && fruitDist <= 2) {
      winProb = 0.7;
    } else if (fruitsNeeded === 1) {
      winProb = 0.5;
    } else if (fruitsNeeded === 2 && fruitDist <= 2) {
      winProb = 0.4;
    } else if (fruitsNeeded === 2) {
      winProb = 0.25;
    } else if (fruitsNeeded === 3) {
      winProb = 0.15;
    } else {
      winProb = 0.1;
    }

    // If team has no fruits on board, can't score
    if (!team.closestFruit) {
      winProb = 0;
    }

    // Calculate payout share
    // For current team: we already own part of the pool, so our share is higher
    // For new team: we're diluting into existing pool
    let payoutShare;
    if (isCurrentTeam && pool > 0) {
      // We likely own a significant portion of this pool already
      // Assume we own roughly (our past bids / pool), but we don't track that
      // Approximate: if pool is small, we probably own most of it
      payoutShare = prizePool / Math.max(pool, 1);
    } else {
      // New team - we'd be adding to their pool
      payoutShare = prizePool / (pool + 1);
    }

    return winProb * payoutShare;
  }

  scoreDirection(dir, parsed, targetFruit) {
    const offset = HEX_DIRECTIONS[dir];
    const newPos = {
      q: parsed.head.q + offset.q,
      r: parsed.head.r + offset.r,
    };

    let score = 0;

    // CRITICAL: Check if this direction eats the fruit!
    // This must be the highest priority
    if (targetFruit) {
      const dist = hexDistance(newPos, targetFruit);

      // If this move eats the fruit (distance becomes 0), give massive bonus
      if (dist === 0) {
        score += 1000; // Overwhelming priority - always eat the fruit!
      } else {
        // Otherwise, score based on proximity
        // Use exponential scoring to strongly prefer closer positions
        score += Math.pow(10 - dist, 2) * 3;
      }
    }

    // Safety: count exits from new position (secondary consideration)
    const exits = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
    score += exits * 5;

    // Prefer staying toward center (minor consideration)
    const distFromCenter = hexDistance(newPos, { q: 0, r: 0 });
    score += (parsed.gridRadius - distFromCenter);

    return score;
  }

  calculateBid(parsed, balance, direction, team) {
    const minBid = parsed.minBid;

    // Check existing votes on this direction
    const existingVote = parsed.votes[direction];

    if (existingVote) {
      const currentAmount = existingVote.amount || existingVote.totalAmount || 0;

      // If different team has votes, consider outbidding
      if (existingVote.team !== team.id && currentAmount >= minBid) {
        // Only outbid if we can afford it and team is favored
        if (balance > currentAmount + 1) {
          return Math.min(currentAmount + 1, Math.floor(balance / 2));
        }
      }
    }

    // Default to minimum bid
    return minBid;
  }
}
