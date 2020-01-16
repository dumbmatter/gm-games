// @flow

import range from "lodash/range";
import { PHASE, PLAYER } from "../../../common";
import { idb } from "../../db";
import { g } from "../../util";
import type { TradePickValues } from "../../../common/types";

/**
 * Estimate draft pick values, based on the generated draft prospects in the database.
 *
 * This was made for team.valueChange, so it could be called once and the results cached.
 *
 * @memberOf core.trade
 * @return {Promise.Object} Resolves to estimated draft pick values.
 */
const getPickValues = async (): Promise<TradePickValues> => {
	const estValues = {};

	let maxLength = 0;
	const seasonOffset = g.phase >= PHASE.RESIGN_PLAYERS ? 1 : 0;
	for (
		let draftYear = g.season + seasonOffset; //value the next three years?
		draftYear < g.season + seasonOffset + 3;
		draftYear++
	) {
		const players = (
			await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
				[draftYear],
				[draftYear, Infinity],
			])
		).filter(p => p.tid === PLAYER.UNDRAFTED); //get undrafted players drafted in draftyear
		if (players.length > 0) {
			players.sort((a, b) => b.value - a.value);
			const yearChangeFactor = 1.1 ** (draftYear - g.season);
			estValues[players[0].draft.year] = players.map(
				p => p.value / yearChangeFactor,
			); // +4 is to generally make picks more valued

			if (estValues[players[0].draft.year].length > maxLength) {
				maxLength = estValues[players[0].draft.year].length;
			}
		}
	}

	//console.log(estValues);

	/*
		estValues is a hash table with keys corresponding to the years that players were drafted
		the values are arrays holding the slightly overvalued player values for each pick
		so like estValues[2015][0] is the value of the player drafted 1st in 2015
	*/

	// Handle case where draft is in progress
	if (g.phase === PHASE.DRAFT) {
		// See what the lowest remaining pick is
		const numPicks = 2 * g.numTeams;
		const draftPicks = (await idb.cache.draftPicks.getAll()).filter(
			dp => dp.season === g.season,
		);
		const diff = numPicks - draftPicks.length;
		if (diff > 0) {
			// Value of 50 is arbitrary since these entries should never appear in a trade since the picks don't exist anymore
			const fakeValues = Array(diff).fill(50);
			estValues[g.season] = fakeValues.concat(estValues[g.season]);
		}
	}

	// Defaults are the average of future drafts
	const seasons = Object.keys(estValues);
	estValues.default = range(maxLength).map(i => {
		const vals = seasons
			.filter(season => {
				// Hacky, because 50 could be the placeholder or a real value
				if (
					g.phase === PHASE.DRAFT &&
					season === String(g.season) &&
					estValues[season][i] === 50
				) {
					return false;
				}

				return true;
			})
			.map(season => estValues[season][i])
			.filter(val => typeof val === "number" && !Number.isNaN(val));

		return vals.reduce((total, val) => total + val, 0) / vals.length;
	});

	return estValues;
};

export default getPickValues;
