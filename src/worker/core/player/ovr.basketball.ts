import type { PlayerRatings } from "../../../common/types.basketball";

/**
 * Calculates the overall rating by averaging together all the other ratings.
 *
 * @memberOf core.player
 * @param {Object.<string, number>} ratings Player's ratings object.
 * @return {number} Overall rating.
 */
const ovr = (ratings: PlayerRatings): number => {
	// See analysis/player-ovr-basketball
	const r =
		0.209 * ratings.hgt +
		0.0648 * ratings.stre +
		0.148 * ratings.spd +
		0.0609 * ratings.jmp +
		0.0314 * ratings.endu +
		0.0109 * ratings.ins +
		0.0288 * ratings.dnk +
		0.0112 * ratings.ft +
		0.15 * ratings.tp +
		0.107 * ratings.oiq +
		0.0799 * ratings.diq +
		0.103 * ratings.drb +
		0.0869 * ratings.pss +
		-0.024 * ratings.fg +
		0.0436 * ratings.reb +
		-6.12;

	// Fudge factor to keep ovr ratings the same as they used to be (back before 2018 ratings rescaling)
	// +8 at 68
	// +4 at 50
	// -5 at 42
	// -10 at 31
	let fudgeFactor = 0;
	if (r >= 68) {
		fudgeFactor = 8;
	} else if (r >= 50) {
		fudgeFactor = 4 + (r - 50) * (4 / 18);
	} else if (r >= 42) {
		fudgeFactor = -5 + (r - 42) * (9 / 8);
	} else if (r >= 31) {
		fudgeFactor = -5 - (42 - r) * (5 / 11);
	} else {
		fudgeFactor = -10;
	}

	const val = Math.round(r + fudgeFactor);

	if (val > 100) {
		return 100;
	}
	if (val < 0) {
		return 0;
	}

	return val;
};

export default ovr;
