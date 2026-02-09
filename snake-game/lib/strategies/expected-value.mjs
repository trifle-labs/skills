/**
 * Expected Value Strategy
 *
 * Maximizes expected value: P(win) * payout per vote
 *
 * Key mechanics:
 * - Last vote wins direction (not highest amount)
 * - Payout is per vote count, not cumulative amount
 * - Voting in extension window: round extends 5s, minBid doubles
 * - Cheap early votes = better ROI than expensive late votes
 * - All-pay auction: everyone pays regardless of outcome
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
      'Maximizes expected value per vote. Timing-aware with counter-bid analysis.',
      options
    );
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    const analysis = this.analyzeTeams(parsed, state.currentTeam);

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

    let newDist = '?';
    if (targetFruit) {
      const offset = HEX_DIRECTIONS[bestDir];
      const newPos = {
        q: parsed.head.q + offset.q,
        r: parsed.head.r + offset.r,
      };
      newDist = hexDistance(newPos, targetFruit);
    }

    // Always bid minBid (simpleBid mode — amount doesn't affect payout share)
    const bidAmount = parsed.minBid;

    const distInfo = `d:${fruitDist}→${newDist}`;
    const costInfo = `cost:${bidAmount}`;

    return {
      direction: bestDir,
      team: targetTeam,
      amount: bidAmount,
      reason: `${analysis.reason} ${distInfo} ${costInfo}`,
    };
  }

  /**
   * Counter-bid analysis: should we re-vote when overridden?
   *
   * Key considerations:
   * - Each vote costs current minBid (possibly doubled from extensions)
   * - Each vote adds +1 to our vote count (payout share)
   * - ROI = (payout per vote) / (cost per vote)
   * - Bidding wars are a trap: cost doubles each extension but payout per vote stays flat
   */
  shouldCounterBid(parsed, balance, state, ourVote) {
    const maxExtensions = this.getOption('maxCounterExtensions', 1);

    // Don't counter if we've exceeded our extension tolerance
    if (parsed.extensions > maxExtensions) {
      return null;
    }

    // Don't counter if minBid has gotten too expensive relative to balance
    if (parsed.minBid > balance * 0.1) {
      return null;
    }

    // Don't counter if budget exhausted
    if ((state.roundBudgetRemaining || 0) < parsed.minBid) {
      return null;
    }

    // Calculate ROI of this counter-bid
    // Our payout share if team wins: prizePool / totalVoteCount
    // Cost: current minBid (if in extension window, this triggers another extension)
    const effectiveCost = parsed.inExtensionWindow ? parsed.minBid * 2 : parsed.minBid;
    const teamVoteCount = (state.roundVoteCount || 0) + 1; // rough estimate
    const payoutPerVote = parsed.prizePool / Math.max(teamVoteCount * 2, 1); // assume ~50% of votes are ours

    // Only counter if expected return exceeds cost
    const team = ourVote.team;
    const winProb = this.estimateWinProb(team, parsed);

    const expectedReturn = winProb * payoutPerVote;
    if (expectedReturn < effectiveCost * 0.5) {
      return null; // not worth it
    }

    // Re-use the same direction and team from our original vote
    return {
      direction: ourVote.direction,
      team: ourVote.team,
      amount: parsed.minBid,
      reason: `counter (ext:${parsed.extensions}, cost:${parsed.minBid}, ev:${expectedReturn.toFixed(1)})`,
    };
  }

  estimateWinProb(team, parsed) {
    const fruitsNeeded = parsed.fruitsToWin - team.score;
    const fruitDist = team.closestFruit?.distance ?? 10;

    if (!team.closestFruit) return 0;
    if (fruitsNeeded <= 0) return 0;
    if (fruitsNeeded === 1 && fruitDist <= 1) return 0.9;
    if (fruitsNeeded === 1 && fruitDist <= 2) return 0.7;
    if (fruitsNeeded === 1) return 0.5;
    if (fruitsNeeded === 2 && fruitDist <= 2) return 0.4;
    if (fruitsNeeded === 2) return 0.25;
    if (fruitsNeeded === 3) return 0.15;
    return 0.1;
  }

  analyzeTeams(parsed, currentTeamId) {
    const teamStats = parsed.teams
      .filter(team => team.closestFruit !== null)
      .map(team => {
        const isCurrentTeam = team.id === currentTeamId;
        const ev = this.calculateExpectedValue(team, parsed, isCurrentTeam);
        return { team, ev, isCurrentTeam };
      });

    if (teamStats.length === 0) {
      return {
        shouldPlay: false,
        recommendedTeam: null,
        reason: 'no_teams_with_fruits',
        teamEV: 0,
      };
    }

    teamStats.sort((a, b) => b.ev - a.ev);

    const bestTeam = teamStats[0];
    const currentTeam = teamStats.find(t => t.team.id === currentTeamId);

    // Early game - join team closest to winning
    if (!currentTeamId) {
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

    // Strongly prefer staying with current team (switching loses stake)
    if (currentTeam) {
      const currentFruitsNeeded = parsed.fruitsToWin - currentTeam.team.score;
      const currentDist = currentTeam.team.closestFruit?.distance ?? 100;
      const currentPool = currentTeam.team.pool || 0;

      if (currentFruitsNeeded > 0 && currentTeam.team.closestFruit) {
        return {
          shouldPlay: true,
          recommendedTeam: currentTeam.team,
          reason: `loyal (need:${currentFruitsNeeded}, dist:${currentDist}, pool:${currentPool.toFixed(0)})`,
          teamEV: currentTeam.ev,
        };
      }

      if (!currentTeam.team.closestFruit || currentFruitsNeeded <= 0) {
        return {
          shouldPlay: true,
          recommendedTeam: bestTeam.team,
          reason: `switching (current team blocked)`,
          teamEV: bestTeam.ev,
        };
      }
    }

    return {
      shouldPlay: true,
      recommendedTeam: bestTeam.team,
      reason: 'best_available',
      teamEV: bestTeam.ev,
    };
  }

  /**
   * EV calculation corrected for vote-count payout model.
   * Payout share = (our votes / total team votes) * prizePool
   * NOT based on amount spent.
   */
  calculateExpectedValue(team, parsed, isCurrentTeam = false) {
    const winProb = this.estimateWinProb(team, parsed);
    const pool = team.pool || 0;
    const prizePool = parsed.prizePool;

    // Payout share based on vote count
    // pool is total amount contributed to team, but with simpleBid each vote = minBid
    // so pool / initialMinBid ~ total vote count for team
    const estimatedTeamVotes = Math.max(pool / (parsed.initialMinBid || 1), 1);

    // If we join, we add 1 vote → our share is 1 / (estimatedTeamVotes + 1)
    const ourShare = 1 / (estimatedTeamVotes + (isCurrentTeam ? 0 : 1));
    const payoutIfWin = prizePool * ourShare;

    return winProb * payoutIfWin;
  }

  scoreDirection(dir, parsed, targetFruit) {
    const offset = HEX_DIRECTIONS[dir];
    const newPos = {
      q: parsed.head.q + offset.q,
      r: parsed.head.r + offset.r,
    };

    let score = 0;

    if (targetFruit) {
      const dist = hexDistance(newPos, targetFruit);
      if (dist === 0) {
        score += 1000; // eat the fruit!
      } else {
        score += Math.pow(10 - dist, 2) * 3;
      }
    }

    const exits = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
    score += exits * 5;

    const distFromCenter = hexDistance(newPos, { q: 0, r: 0 });
    score += (parsed.gridRadius - distFromCenter);

    return score;
  }
}
