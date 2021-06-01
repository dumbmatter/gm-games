import { allStar, finances, player, team } from "..";
import { idb } from "../../db";
import { g, helpers, random } from "../../util";
import type { Player, MinimalPlayerRatings } from "../../../common/types";
import {
	COMPOSITE_WEIGHTS,
	DEFAULT_PLAY_THROUGH_INJURIES,
	isSport,
	PHASE,
} from "../../../common";
import playThroughInjuriesFactor from "../../../common/playThroughInjuriesFactor";

const processTeam = (
	teamInput: {
		tid: number;
		playThroughInjuries: [number, number];
		depth?: any;
	},
	teamSeason: {
		won: number;
		lost: number;
		tied: number;
		otl: number;
		cid: number;
		did: number;
		expenses: {
			health: {
				rank: number;
			};
		};
	},
	teamStats: Record<string, number>,
	players: Player<MinimalPlayerRatings>[],
	playerStats: Record<string, number>,
) => {
	const allStarGame = teamInput.tid === -1 || teamInput.tid === -2;

	if (!allStarGame) {
		players.sort((a, b) => a.rosterOrder - b.rosterOrder);
	}

	// Initialize team composite rating object
	const compositeRating: any = {};

	if (isSport("basketball")) {
		for (const rating of Object.keys(COMPOSITE_WEIGHTS)) {
			compositeRating[rating] = 0;
		}
	}

	// Injury-adjusted ovr
	const playersCurrent = players
		.filter((p: any) => p.injury.gamesRemaining === 0)
		.map(p => ({
			value: p.value,
			ratings: {
				ovr: player.fuzzRating(
					p.ratings[p.ratings.length - 1].ovr,
					p.ratings[p.ratings.length - 1].fuzz,
				),
				ovrs: player.fuzzOvrs(
					p.ratings[p.ratings.length - 1].ovrs,
					p.ratings[p.ratings.length - 1].fuzz,
				),
				pos: p.ratings[p.ratings.length - 1].pos,
			},
		}));
	const ovr = team.ovr(playersCurrent);

	const t: any = {
		id: teamInput.tid,
		pace: 0,
		won: teamSeason.won,
		lost: teamSeason.lost,
		tied: g.get("ties", "current") ? teamSeason.tied : undefined,
		otl: g.get("otl", "current") ? teamSeason.otl : undefined,
		cid: teamSeason.cid,
		did: teamSeason.did,
		ovr,
		stat: {},
		player: [],
		synergy: {
			off: 0,
			def: 0,
			reb: 0,
		},
		healthRank: finances.getRankLastThree([teamSeason], "expenses", "health"),
		compositeRating,
		depth: teamInput.depth,
	};

	let playThroughInjuriesBoth;
	if (g.get("userTids").includes(teamInput.tid) && !g.get("spectator")) {
		playThroughInjuriesBoth = teamInput.playThroughInjuries;
	} else {
		playThroughInjuriesBoth = DEFAULT_PLAY_THROUGH_INJURIES;
	}

	const playThroughInjuries =
		playThroughInjuriesBoth[g.get("phase") === PHASE.PLAYOFFS ? 1 : 0];

	for (const p of players) {
		const injuryFactor = playThroughInjuriesFactor(p.injury.gamesRemaining);

		const rating = p.ratings[p.ratings.length - 1];
		const playerCompositeRatings: any = {};
		const p2 = {
			id: p.pid,
			pid: p.pid, // for getDepthPlayers, eventually do it all this way
			name: `${p.firstName} ${p.lastName}`,
			age: g.get("season") - p.born.year,
			pos: rating.pos,
			valueNoPot: p.valueNoPot * injuryFactor,
			stat: {},
			compositeRating: playerCompositeRatings,
			skills: rating.skills,
			injury: {
				...p.injury,
				playingThrough:
					p.injury.gamesRemaining > 0 &&
					p.injury.gamesRemaining <= playThroughInjuries,
			},
			injured: p.injury.gamesRemaining > playThroughInjuries,
			jerseyNumber:
				p.stats.length > 0
					? p.stats[p.stats.length - 1].jerseyNumber
					: undefined,
			ptModifier: p.ptModifier,
			ovrs: rating.ovrs,
		};

		// Reset ptModifier for AI teams. This should not be necessary since it should always be 1, but let's be safe.
		if (!g.get("userTids").includes(t.id)) {
			p2.ptModifier = 1;
		}

		// These use the same formulas as the skill definitions in player.skills!
		for (const k of Object.keys(COMPOSITE_WEIGHTS)) {
			p2.compositeRating[k] =
				player.compositeRating(
					rating,
					COMPOSITE_WEIGHTS[k].ratings,
					COMPOSITE_WEIGHTS[k].weights,
					false,
				) * injuryFactor;

			if (
				isSport("hockey") &&
				k === "goalkeeping" &&
				g.get("phase") !== PHASE.PLAYOFFS
			) {
				const numConsecutiveGamesG = p.numConsecutiveGamesG ?? 0;
				if (p.numConsecutiveGamesG !== undefined) {
					(p2 as any).numConsecutiveGamesG = p.numConsecutiveGamesG;
				}

				if (numConsecutiveGamesG > 0) {
					// Decrease rating by up to 40%
					p2.compositeRating[k] *= helpers.bound(
						1 - numConsecutiveGamesG * random.uniform(0.0, 0.09),
						0.6,
						1,
					);
				}
			}
		}

		if (isSport("basketball")) {
			p2.compositeRating.usage = p2.compositeRating.usage ** 1.9;
		}

		p2.stat = {
			gs: 0,
			min: 0,
			...playerStats,

			// Starters will play at least 3 minutes before being subbed out, after that the default here doesn't matter
			courtTime: -3,
			benchTime: 0,
			energy: 1,
		};
		t.player.push(p2);
	}

	for (const p of t.player) {
		delete p.pid;
	}

	// Number of players to factor into pace and defense rating calculation
	let numPlayers = t.player.length;

	if (numPlayers > 7) {
		numPlayers = 7;
	}

	if (isSport("basketball")) {
		// Would be better if these were scaled by average min played and endurancence
		t.pace = 0;

		for (let i = 0; i < numPlayers; i++) {
			t.pace += t.player[i].compositeRating.pace;
		}

		t.pace /= numPlayers;
		t.pace = t.pace * 15 + 100; // Scale between 100 and 115
		const pace_avg = 108.4;
		const pace_diff = t.pace - pace_avg;
		const pace_adj = 15 * Math.tanh(1 * pace_diff);
		t.pace = pace_avg + pace_adj;
		if (allStarGame) {
			t.pace *= 1.15;
		}
	}

	t.stat = { ...teamStats, pts: 0, ptsQtrs: [0] };
	return t;
};

/**
 * Load the teams specified by tids into an object of team objects.
 *
 * The team objects contain all the information needed to simulate games. It would be more efficient if it only loaded team data for teams that are actually playing, particularly in the playoffs.
 *
 * @memberOf core.game
 * @param {IDBTransaction} ot An IndexedDB transaction on players and teams.
 * @param {Promise} Resolves to an array of team objects, ordered by tid.
 */
const loadTeams = async (tids: number[]) => {
	const playerStats = player.stats.raw.reduce<Record<string, number>>(
		(stats, stat) => {
			if (stat === "gp" || stat === "minAvailable") {
				return stats;
			}

			stats[stat] = 0;
			return stats;
		},
		{},
	);

	const teamStats = team.stats.raw.reduce<Record<string, number>>(
		(stats, stat) => {
			stats[stat] = 0;
			return stats;
		},
		{},
	);

	const teams: Record<number, undefined | ReturnType<typeof processTeam>> = {};
	if (tids.length === 2 && tids.includes(-1) && tids.includes(-2)) {
		// All-Star Game
		const allStars = await allStar.getOrCreate();
		if (!allStars.finalized) {
			await allStar.draftAll();
		}

		for (const tid of tids) {
			const allStarsTeamInd = tid === -1 ? 0 : 1;
			const players: Player<MinimalPlayerRatings>[] = await Promise.all(
				allStars.teams[allStarsTeamInd].map(async ({ pid }) => {
					const p = await idb.cache.players.get(pid);

					if (!p) {
						throw new Error(`Can't find player ${pid}`);
					}

					return p;
				}),
			);

			teams[tid] = processTeam(
				{
					tid,
					playThroughInjuries: [0, 0],
				},
				{
					cid: -1,
					did: -1,
					won: 0,
					lost: 0,
					tied: 0,
					otl: 0,
					expenses: {
						health: {
							rank: 1,
						},
					},
				},
				teamStats,
				players,
				playerStats,
			);
		}
	} else {
		await Promise.all(
			tids.map(async tid => {
				const [players, team, teamSeason] = await Promise.all([
					idb.cache.players.indexGetAll("playersByTid", tid),
					idb.cache.teams.get(tid),
					idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
						tid,
						g.get("season"),
					]),
				]);

				if (!team) {
					throw new Error("Invalid tid");
				}
				if (!teamSeason) {
					throw new Error("Team season not found");
				}

				teams[tid] = processTeam(
					team,
					teamSeason,
					teamStats,
					players,
					playerStats,
				);
			}),
		);
	}

	return teams;
};

export default loadTeams;
