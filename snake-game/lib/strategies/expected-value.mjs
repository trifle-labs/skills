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

    // Score all valid directions
    const dirScores = parsed.validDirections.map(dir => ({
      dir,
      score: this.scoreDirection(dir, parsed, targetFruit),
    })).sort((a, b) => b.score - a.score);

    const bestDir = dirScores[0]?.dir;
    if (!bestDir) return null;

    // Determine bid amount
    const bidAmount = this.calculateBid(parsed, balance, bestDir, targetTeam);

    return {
      direction: bestDir,
      team: targetTeam,
      amount: bidAmount,
      reason: analysis.reason,
      analysis: {
        teamEV: analysis.teamEV,
        dirScore: dirScores[0].score,
      },
    };
  }

  analyzeTeams(parsed, currentTeamId) {
    const minEV = this.getOption('minExpectedValue', 0.5);
    const switchThreshold = this.getOption('switchThreshold', 1.5);

    // Calculate EV for each team (only teams with fruits can be targeted)
    const teamStats = parsed.teams
      .filter(team => team.closestFruit !== null) // Must have fruit to target
      .map(team => {
        const ev = this.calculateExpectedValue(team, parsed);
        return { team, ev };
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

    // Early game - just join the best team
    if (!currentTeamId && bestTeam.ev > 0) {
      return {
        shouldPlay: true,
        recommendedTeam: bestTeam.team,
        reason: 'joining_best_team',
        teamEV: bestTeam.ev,
      };
    }

    // Check if we should switch teams
    if (currentTeam && bestTeam.team.id !== currentTeamId) {
      if (bestTeam.ev > currentTeam.ev * switchThreshold) {
        return {
          shouldPlay: true,
          recommendedTeam: bestTeam.team,
          reason: `better_ev (${bestTeam.ev.toFixed(2)} vs ${currentTeam.ev.toFixed(2)})`,
          teamEV: bestTeam.ev,
        };
      }
    }

    // Stay with current team if it has decent EV
    if (currentTeam && currentTeam.ev > minEV) {
      return {
        shouldPlay: true,
        recommendedTeam: currentTeam.team,
        reason: 'staying_with_team',
        teamEV: currentTeam.ev,
      };
    }

    // Pick best team if EV is good enough
    if (bestTeam.ev > minEV) {
      return {
        shouldPlay: true,
        recommendedTeam: bestTeam.team,
        reason: 'best_ev_available',
        teamEV: bestTeam.ev,
      };
    }

    // No good options
    return {
      shouldPlay: false,
      recommendedTeam: null,
      reason: 'no_good_ev',
      teamEV: bestTeam.ev,
    };
  }

  calculateExpectedValue(team, parsed) {
    const fruitsNeeded = parsed.fruitsToWin - team.score;
    const fruitDist = team.closestFruit?.distance ?? 10;
    const pool = team.pool;
    const prizePool = parsed.prizePool;

    // Estimate win probability
    let winProb = 0;
    if (fruitsNeeded <= 0) {
      winProb = 0; // Already won
    } else if (fruitsNeeded === 1 && fruitDist <= 2) {
      winProb = 0.7;
    } else if (fruitsNeeded === 1) {
      winProb = 0.5;
    } else if (fruitsNeeded === 2 && fruitDist <= 3) {
      winProb = 0.3;
    } else if (fruitsNeeded === 2) {
      winProb = 0.2;
    } else {
      winProb = 0.1;
    }

    // If team has no fruits, can't score
    if (!team.closestFruit) {
      winProb *= 0.5;
    }

    // Calculate payout share (smaller pool = bigger share)
    const payoutShare = prizePool / (pool + 1);

    return winProb * payoutShare;
  }

  scoreDirection(dir, parsed, targetFruit) {
    const offset = HEX_DIRECTIONS[dir];
    const newPos = {
      q: parsed.head.q + offset.q,
      r: parsed.head.r + offset.r,
    };

    let score = 0;

    // Safety: count exits from new position
    const exits = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
    score += exits * 10;

    // Distance to target fruit
    if (targetFruit) {
      const dist = hexDistance(newPos, targetFruit);
      score += (10 - dist) * 5;
    }

    // Prefer staying toward center
    const distFromCenter = hexDistance(newPos, { q: 0, r: 0 });
    score += (parsed.gridRadius - distFromCenter) * 2;

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
