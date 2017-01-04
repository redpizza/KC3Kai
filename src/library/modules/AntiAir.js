/*

AntiAir: anti-air related calculations
  
- variable naming convention:
	- fleetObj: instance of KC3Fleet
	- shipObj: instance of KC3Ship
		- mst: master data of either ship or gear
		- pred: predicates, a function that accepts a single parameter and returns a boolean value
		- predXXX: predicate combinators. "predXXX(pred1, pred2, ...)" combines pred1, pred2, ...
          in some specific way to produce a new prediate.

- module contents:
	- shipProportionalShotdownRate(shipObj)
	  returns a value (supposed to be 0 <= v <= 1) indicating the rate of planes
	  being shot down. note that it might be possible for this value to exceed 1.0.
	- shipProportionalShotdown(shipObj, num)
	  same as "shipProportionalShotdownRate", except that this one calculates
	  the number of planes being shotdown with slot capacity is given by "num".
	- shipFixedShotdown(shipObj, fleetObj, formationModifier, [K])
	  returns an integer indicating how many planes will be shotdown.
	  "formationModifier" takes one of: 1/1.2/1.6 depending on formation
	  (see "getFormationModifiers" for detail).
	  K (defaults to 1) is optional, depending on whether AACI is triggered and
	  which kind of AACI is triggered.
	- shipFixedShotdownRange(shipObj, fleetObj, formationModifier)
	  like "shipFixedShotdown" but this one returns a range by considering
      all possible AACIs "shipObj" can perform and use the largest modifier as upper bound.
	- possibleAACIs(shipObj)
	  returns a list of possible AACI API Ids that ship could perform.
	- AACITable[<AACI API>] returns a record of AACI info:
		- id: AACI API Id
		- fixed: fixed shotdown bonus
		- modifier: the "K" value to "shipFixedShotdown" when this AACI is triggered
		- predicate: calling "predicateShip(shipObj)" will test whether "shipObj" can
		  perform this particular kind of AACI.
	- other not explicitly listed contents are for debugging or internal use only.

 */
(function() {
	"use strict";

	function categoryEq(n) {
		return function (mst) {
			return mst.api_type[2] /* category */ === n;
		};
	}

	function iconEq(n) {
		return function (mst) {
			return mst.api_type[3] /* icon */ === n;
		};
	}

	// a predicate combinator, "predAnyOf(f,g)(x)" is the same as "f(x) || g(x)"
	// test all predicates passed as argument in order,
	// return the first non-falsy value or "false" if all predicates have falled.
	function predAnyOf(/* list of predicates */) {
		var args = arguments;
		return function(x) {
			for (var fInd in args) {
				var result = args[fInd](x);
				if (result)
					return result;
			}
			return false;
		};
	}

	function predAllOf(/* list of predicates */) {
		var args = arguments;
		return function(x) {
			var result = true;
			for (var fInd in args) {
				result = args[fInd](x);
				if (! result)
					return false;
			}
			return result;
		};
	}

	function predNot( pred ) {
		return function(x) {
			return ! pred(x);
		};
	}

	// all types of Radar (12 for small, 13 for large)
	function isRadar(mst) {
		return (categoryEq(12)(mst) || categoryEq(13)(mst));
	}

	// AA Radar
	// Surface Radar are excluded by checking whether
	// the equipment gives AA stat (api_tyku)
	function isAARadar(mst) {
		return isRadar(mst) && 
			mst.api_tyku > 0;
	}

	// AAFD: check by category (36)
	var isAAFD = categoryEq(36);

	// High-angle mounts: check by icon (16)
	var isHighAngleMount = iconEq(16);
	
	// Type 3 Shell
	var isType3Shell = categoryEq(18);

	// Anti-air gun includes machine guns and rocket launchers
	var isAAGun = categoryEq(21);

	var isRedGun = predAnyOf(
		iconEq(1),
		iconEq(2),
		iconEq(3));
	
	var isYellowGun = iconEq(4);
	var isFighter = categoryEq(6);
	var isDiveBomber = categoryEq(7);
	var isSeaplaneRecon = categoryEq(10);

	var isLargeCaliberMainGun = categoryEq(3);

	function isBuiltinHighAngleMount(mst) {
		return [
			122 /* aki-gun */,
			130 /* maya-gun */,
			135 /* 90mm single HA */,
			172 /* 5inch */
		].indexOf( mst.api_id ) !== -1;
	}

	function isCDMG(mst) {
		return [
			131 /* 25mm triple (CD) */,
			173 /* Bofors */,
			191 /* QF 2-pounder */
		].indexOf( mst.api_id ) !== -1;
	}

	// for equipments the coefficient is different for
	// calculating adjusted ship AA stat and fleet AA stat,
	// so let's use the following naming convention:
	//
	// - "getShipXXX" is for calculating adjusted AA stat for individual ships
	// - "getFleetXXX" for fleet AA
	//
	// verbs might change but the same convention should follow.

	// TODO: abyssal equipments into consideration?

	// it is possible for conditions to have overlap:
	// Akizuki-gun for example is both high angle mount and short caliber main gun.
	// to resolve this:
	// - the conditions are re-ordered so the highest applicable
	//   modifier is always checked first.
	// - the wiki says main gun (red), so maybe an icon-based checker "isRedGun"
	//   might be more appropriate.

	function getShipEquipmentModifier(mst) {
		if (isAAGun(mst))
			return 6;
		if (isHighAngleMount(mst) || isAAFD(mst))
			return 4;
		if (isAARadar(mst))
			return 3;

		return 0;
	}

	function getFleetEquipmentModifier(mst) {
		if (isType3Shell(mst))
			return 0.6;
		if (isAARadar(mst))
			return 0.4;
		if (isHighAngleMount(mst) || isAAFD(mst))
			return 0.35;
		if (predAnyOf(isRedGun,
				  isYellowGun,
				  isAAGun,
				  isFighter,
				  isDiveBomber,
				  isSeaplaneRecon)(mst))
			return 0.2;

		return 0;
	}

	function getShipImprovementModifier(mst) {
		if (isAAGun(mst))
			return 4;
		if (isHighAngleMount(mst))
			return 3;
		if (isAARadar(mst))
			return 0;

		return 0;
	}

	function getFleetImprovementModifier(mst) {
		if (isHighAngleMount(mst))
			return 3;
		if (isAAFD(mst))
			return 2;
		if (isAARadar(mst))
			return 1.5;
		if (isAAGun(mst))
			return 0;

		return 0;
	}

	function calcEquipmentAADefense(
		mst,
		stars /* number 0..10 */,
		forFleet /* bool */) {

		var eTypMod = 
			(forFleet 
			 ? getFleetEquipmentModifier 
			 : getShipEquipmentModifier)(mst);
		var eImproveMod =
			(forFleet
			 ? getFleetImprovementModifier
			 : getShipImprovementModifier)(mst);
		var aaStat = mst.api_tyku;
		return eTypMod*aaStat + eImproveMod*Math.sqrt( stars );
	}

	// returns a special floor function f(x) = q * floor( x / q )
	// - q = 1 if shipObj equips nothing
	// - q = 2 otherwise
	function specialFloor(shipObj) {
		var q = 1;
		var allItems = allShipEquipments(shipObj);
		for (var itemInd in allItems) {
			var item = allItems[itemInd];
			if (item.masterId !== 0) {
				q = 2;
				break;
			}
		}

		return function(x) {
			return q*Math.floor(x / q);
		};
	}

	function allShipEquipments(shipObj) {
		return [
			shipObj.equipment(0),
			shipObj.equipment(1),
			shipObj.equipment(2),
			shipObj.equipment(3),
			shipObj.exItem()];
	}

	function shipEquipmentAntiAir(shipObj, forFleet) {
		var allItems = allShipEquipments(shipObj);
		return allItems.reduce( function(curAA, item) {
			return curAA + item.aaDefense(forFleet);
		}, 0);
	}

	function shipAdjustedAntiAir(shipObj) {
		return shipObj.aa[1] + shipEquipmentAntiAir(shipObj,false);
	}

	function shipProportionalShotdownRate(shipObj) {
		var floor = specialFloor(shipObj);
		var adjustedAA = shipAdjustedAntiAir(shipObj);
		return floor(adjustedAA) / 400;
	}

	function shipProportionalShotdown(shipObj, num) {
		return Math.floor( shipProportionalShotdownRate(shipObj) * num );
	}

	function getFormationModifiers(id) {
		return (id === 1 || id === 4 || id === 5) ? 1  // line ahead / echelon / line abreast
			:  (id === 2) ? 1.2 // double line
			:  (id === 3) ? 1.6 // diamond
			:  NaN; // NaN for indicating an invalid id
	}

	function fleetAdjustedAntiAir(fleetObj, formationModifier) {
		var allShipEquipmentAA = fleetObj.ship().reduce( function(curAA, ship) {
			return curAA + shipEquipmentAntiAir(ship, true);
		}, 0);
		return 1.54 * Math.floor( formationModifier * allShipEquipmentAA );
	}

	function shipFixedShotdown(shipObj, fleetObj, formationModifier, K /* AACI modifier, default to 1 */) {
		K = typeof K === "undefined" ? 1 : K;
		var floor = specialFloor(shipObj);
		var adjustedAA = shipAdjustedAntiAir(shipObj);
		return Math.floor( (floor(adjustedAA) + Math.floor( fleetAdjustedAntiAir(fleetObj, formationModifier) ))
						   * K / 10);
	}

	// avoid modifying this structure directly, use "declareAACI" instead.
	var AACITable = {};

	// predicate is a function f:
	// f(shipObj)
	// returns a boolean to indicate whether the ship in question (with equipments)
	// is capable of performing such type of AACI
	function declareAACI(
		apiId,
		fixedBonus, 
		modifier, 
		predicate) {
		AACITable[apiId] =
			{id: apiId,
			 fixed: fixedBonus,
			 modifier: modifier,
			 predicate: predicate };
	}

	function isNotSubmarine( shipObj ) {
		var stype = shipObj.master().api_stype;
		return [13 /* SS */, 14 /* SSV */].indexOf( stype ) === -1;
	}

	function isBattleship( shipObj ) {
		var stype = shipObj.master().api_stype;
		return [8 /* FBB */, 9 /* BB */, 10 /* BBV */].indexOf( stype ) !== -1;
	}

	function isAkizukiClass( shipObj ) {
		return [
			421, 330 /* Akizuki & Kai */,
			422, 346 /* Teruzuki & Kai */,
			423, 357 /* Hatsuzuki & Kai */
		].indexOf( shipObj.masterId ) !== -1;
	}

	function masterIdEq( n ) {
		return function(shipObj) {
			return shipObj.masterId === n;
		};
	}

	var isMayaK2 = masterIdEq( 428 );
	var isIsuzuK2 = masterIdEq( 141 );
	var isKasumiK2B = masterIdEq( 470 );
	var isSatsukiK2 = masterIdEq( 418 );
	var isKinuK2 = masterIdEq( 487 );
	
	// turns a "shipObj" into the list of her equipments
	// for its parameter function "pred"
	function withEquipmentMsts( pred ) {
		return function(shipObj) {
			var gears = allShipEquipments(shipObj)
				.filter( function(g) { return g.masterId !== 0; } )
				.map( function(g) { return g.master(); });
			return pred(gears);
		};
	}

	// "hasAtLeast(pred)(n)(xs)" is the same as:
	// xs.filter(pred).length >= n
	function hasAtLeast(pred, n) {
		return function(xs) {
			return xs.filter(pred).length >= n;
		};
	}

	// "hasSome(pred)(xs)" is the same as:
	// xs.some(pred)
	function hasSome(pred) {
		return function(xs) {
			return xs.some(pred);
		};
	}

	// all non-sub ships
	declareAACI(
		5, 4, 1.5,
		predAllOf(
			isNotSubmarine,
			withEquipmentMsts(
				predAllOf(
					hasAtLeast(isBuiltinHighAngleMount, 2),
					hasSome( isAARadar )))));

	declareAACI(
		8, 4, 1.4,
		predAllOf(
			isNotSubmarine,
			withEquipmentMsts(
				predAllOf(
					hasSome( isBuiltinHighAngleMount ),
					hasSome( isAARadar )))));

	declareAACI(
		7, 3, 1.35,
		predAllOf(
			isNotSubmarine,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isAAFD ),
					hasSome( isAARadar )))));

	declareAACI(
		9, 2, 1.3,
		predAllOf(
			isNotSubmarine,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isAAFD )))));

	declareAACI(
		12, 3, 1.25,
		predAllOf(
			isNotSubmarine,
			withEquipmentMsts(
				predAllOf(
					hasSome( isCDMG ),
					/* CDMGs are AAGuns, so we need at least 2 AA guns 
					   including the CDMG one we have just counted */
					hasAtLeast(isAAGun, 2),
					hasSome( isAARadar )))));

	// battleship special AACIs
	declareAACI(
		4, 6, 1.4,
		predAllOf(
			isBattleship,
			withEquipmentMsts(
				predAllOf(
					hasSome( isLargeCaliberMainGun ),
					hasSome( isType3Shell ),
					hasSome( isAAFD ),
					hasSome( isAARadar )))));

	declareAACI(
		6, 4, 1.45,
		predAllOf(
			isBattleship,
			withEquipmentMsts(
				predAllOf(
					hasSome( isLargeCaliberMainGun ),
					hasSome( isType3Shell ),
					hasSome( isAAFD )))));

	// Akizuki-class AACIs
	declareAACI(
		1, 7, 1.7,
		predAllOf(
			isAkizukiClass,
			withEquipmentMsts(
				predAllOf(
					hasAtLeast( isHighAngleMount, 2 ),
					hasSome( isRadar )))));
	declareAACI(
		2, 6, 1.7,
		predAllOf(
			isAkizukiClass,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isRadar )))));
	declareAACI(
		3, 4, 1.6,
		predAllOf(
			isAkizukiClass,
			withEquipmentMsts(
				hasAtLeast( isHighAngleMount, 2 ))));

	// Maya K2
	declareAACI(
		10, 8, 1.65,
		predAllOf(
			isMayaK2,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isCDMG ),
					hasSome( isAARadar )))));
	declareAACI(
		11, 6, 1.5,
		predAllOf(
			isMayaK2,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isCDMG )))));

	// Isuzu K2
	declareAACI(
		14, 4, 1.45,
		predAllOf(
			isIsuzuK2,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isAAGun ),
					hasSome( isAARadar )))));
	declareAACI(
		15, 3, 1.3,
		predAllOf(
			isIsuzuK2,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isAAGun )))));

	// Kasumi K2B
	declareAACI(
		16, 4, 1.4,
		predAllOf(
			isKasumiK2B,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isAAGun ),
					hasSome( isAARadar )))));
	declareAACI(
		17, 2, 1.25,
		predAllOf(
			isKasumiK2B,
			withEquipmentMsts(
				predAllOf(
					hasSome( isHighAngleMount ),
					hasSome( isAAGun )))));
	// Satsuki K2
	declareAACI(
		18, 2, 1.2,
		predAllOf(
			isSatsukiK2,
			withEquipmentMsts(
				hasSome( isCDMG ))));

	// Kinu K2
	declareAACI(
		19, 5, 1.45,
		predAllOf(
			isKinuK2,
			withEquipmentMsts(
				predAllOf(
					/* any HA with builtin AAFD will not work  */
					predNot( hasSome( isBuiltinHighAngleMount )),
					hasSome( isHighAngleMount ),
					hasSome( isCDMG )))));
	declareAACI(
		20, 3, 1.25,
		predAllOf(
			isKinuK2,
			withEquipmentMsts(
				hasSome( isCDMG ))));

	// return a list of possible AACI APIs based on ship and her equipments
	// - returns a list of **strings**, not numbers
	//   (since object keys has to be strings, and AACITable[key] accepts keys
	//   of both number and string anyway)
	// - because of the game mechanism, some AACI API Ids returned might be overlapped
	//   and never triggered, "possibleAACIs" is **not** responsible for removing never-triggered
	//   AACI from resulting list.
	function possibleAACIs( shipObj ) {
		var result = [];
		$.each( AACITable, function(k,entry) {
			if (entry.predicate( shipObj ))
				result.push( k );
		});
		return result;
	}

	function shipFixedShotdownRange(shipObj, fleetObj, formationModifier) {
		var possibleAACIModifiers = possibleAACIs(shipObj).map( function( apiId ) {
			return AACITable[apiId].modifier;
		});
		// default value 1 is always available, making call to Math.max always non-empty
		possibleAACIModifiers.push( 1 );
		var mod = Math.max.apply( null, possibleAACIModifiers );
		return [ shipFixedShotdown(shipObj, fleetObj, formationModifier, 1),
				 shipFixedShotdown(shipObj, fleetObj, formationModifier, mod) ];
	}
	

	// exporting module
	window.AntiAir = {
		getFleetEquipmentModifier: getFleetEquipmentModifier,
		getShipEquipmentModifier: getShipEquipmentModifier,
		getFleetImprovementModifier: getFleetImprovementModifier,
		getShipImprovementModifier: getShipImprovementModifier,

		calcEquipmentAADefense: calcEquipmentAADefense,
		shipEquipmentAntiAir: shipEquipmentAntiAir,
		shipAdjustedAntiAir: shipAdjustedAntiAir,
		specialFloor: specialFloor,

		shipProportionalShotdown: shipProportionalShotdown,
		shipProportionalShotdownRate: shipProportionalShotdownRate,

		getFormationModifiers: getFormationModifiers,
		fleetAdjustedAntiAir: fleetAdjustedAntiAir,
		shipFixedShotdown: shipFixedShotdown,
		shipFixedShotdownRange: shipFixedShotdownRange,

		AACITable: AACITable,
		possibleAACIs: possibleAACIs
	};
})();
