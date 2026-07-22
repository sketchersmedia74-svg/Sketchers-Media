/**
 * Generates a large locations.json rotation list by expanding "USA" into
 * one query per city (and per niche keyword variation) across all 50
 * states — needed because Google Maps caps a single search at ~120
 * results, so a single "dentists in USA" (or even "dentists in Texas")
 * query can never surface more than a sliver of the real number of
 * dentists nationwide. Splitting into hundreds/thousands of city+keyword
 * queries is what actually gets you into the tens of thousands.
 *
 * Usage:
 *   node generate-locations.mjs --niches "dentists,dental clinic,orthodontist" --out locations.json
 *   node generate-locations.mjs --niches "dentists" --states TX,CA,NY --out locations.json
 *
 * Feel free to hand-edit the CITIES_BY_STATE table below to add/remove
 * cities, or trim it down to specific states you actually want to target.
 */

import fs from "node:fs";

const CITIES_BY_STATE = {
  AL: ["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa", "Hoover", "Dothan", "Auburn", "Decatur", "Madison"],
  AK: ["Anchorage", "Fairbanks", "Juneau", "Wasilla", "Sitka", "Ketchikan"],
  AZ: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Glendale", "Gilbert", "Tempe", "Peoria", "Surprise", "Yuma", "Flagstaff"],
  AR: ["Little Rock", "Fort Smith", "Fayetteville", "Springdale", "Jonesboro", "Rogers", "Conway"],
  CA: [
    "Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno",
    "Sacramento", "Long Beach", "Oakland", "Bakersfield", "Anaheim",
    "Riverside", "Santa Ana", "Irvine", "Chula Vista", "Fremont",
    "San Bernardino", "Modesto", "Fontana", "Oxnard", "Moreno Valley",
    "Huntington Beach", "Glendale", "Santa Clarita", "Oceanside", "Palmdale",
  ],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder", "Lakewood", "Thornton", "Pueblo", "Greeley", "Loveland"],
  CT: ["Bridgeport", "New Haven", "Hartford", "Stamford", "Waterbury", "Norwalk", "Danbury"],
  DE: ["Wilmington", "Dover", "Newark", "Middletown"],
  FL: [
    "Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg",
    "Hialeah", "Tallahassee", "Fort Lauderdale", "Cape Coral", "Sarasota",
    "Port St. Lucie", "Pembroke Pines", "Hollywood", "Gainesville", "Miramar",
    "Coral Springs", "West Palm Beach", "Clearwater", "Naples", "Boca Raton",
  ],
  GA: ["Atlanta", "Augusta", "Columbus", "Savannah", "Athens", "Sandy Springs", "Roswell", "Macon", "Johns Creek", "Albany"],
  HI: ["Honolulu", "Hilo", "Kailua", "Kaneohe", "Kahului"],
  ID: ["Boise", "Meridian", "Idaho Falls", "Nampa", "Pocatello", "Coeur d'Alene"],
  IL: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Elgin", "Peoria", "Champaign", "Waukegan"],
  IN: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel", "Bloomington", "Fishers", "Hammond"],
  IA: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City", "Waterloo"],
  KS: ["Wichita", "Overland Park", "Kansas City", "Topeka", "Olathe", "Lawrence"],
  KY: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington"],
  LA: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles", "Kenner"],
  ME: ["Portland", "Bangor", "Lewiston", "Augusta"],
  MD: ["Baltimore", "Columbia", "Annapolis", "Silver Spring", "Frederick", "Rockville", "Gaithersburg"],
  MA: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Brockton", "New Bedford", "Quincy"],
  MI: ["Detroit", "Grand Rapids", "Ann Arbor", "Lansing", "Flint", "Warren", "Sterling Heights", "Dearborn", "Kalamazoo"],
  MN: ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington", "Brooklyn Park", "Plymouth"],
  MS: ["Jackson", "Gulfport", "Hattiesburg", "Southaven", "Biloxi"],
  MO: ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence", "Lee's Summit", "St. Joseph"],
  MT: ["Billings", "Missoula", "Bozeman", "Great Falls", "Helena"],
  NE: ["Omaha", "Lincoln", "Bellevue", "Grand Island"],
  NV: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks"],
  NH: ["Manchester", "Nashua", "Concord", "Derry"],
  NJ: ["Newark", "Jersey City", "Paterson", "Trenton", "Elizabeth", "Edison", "Woodbridge", "Camden"],
  NM: ["Albuquerque", "Las Cruces", "Santa Fe", "Rio Rancho", "Roswell"],
  NY: [
    "New York", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany",
    "New Rochelle", "Mount Vernon", "Schenectady", "Utica", "White Plains",
  ],
  NC: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Asheville", "Fayetteville", "Cary", "Wilmington", "High Point"],
  ND: ["Fargo", "Bismarck", "Grand Forks", "Minot"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Parma", "Canton", "Youngstown", "Lorain"],
  OK: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond", "Lawton"],
  OR: ["Portland", "Eugene", "Salem", "Bend", "Gresham", "Hillsboro", "Beaverton"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Harrisburg", "Reading", "Scranton", "Bethlehem", "Lancaster"],
  RI: ["Providence", "Warwick", "Cranston", "Pawtucket"],
  SC: ["Columbia", "Charleston", "Greenville", "Myrtle Beach", "Rock Hill", "Mount Pleasant", "Summerville"],
  SD: ["Sioux Falls", "Rapid City", "Aberdeen"],
  TN: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin"],
  TX: [
    "Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso",
    "Arlington", "Corpus Christi", "Plano", "Lubbock", "Laredo",
    "Irving", "Garland", "Frisco", "McKinney", "Amarillo", "Grand Prairie",
    "Brownsville", "Pasadena", "Mesquite", "Killeen", "McAllen",
  ],
  UT: ["Salt Lake City", "Provo", "Ogden", "West Valley City", "West Jordan", "Orem", "Sandy"],
  VT: ["Burlington", "Montpelier", "Rutland"],
  VA: ["Virginia Beach", "Richmond", "Norfolk", "Arlington", "Alexandria", "Chesapeake", "Newport News", "Roanoke"],
  WA: ["Seattle", "Spokane", "Tacoma", "Bellevue", "Vancouver", "Everett", "Kent", "Renton", "Spokane Valley"],
  WV: ["Charleston", "Huntington", "Morgantown", "Parkersburg"],
  WI: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine", "Appleton"],
  WY: ["Cheyenne", "Casper", "Laramie", "Gillette"],
};

function parseArgs(argv) {
  const args = { niches: ["dentists"], out: "locations.json", states: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--niche" || argv[i] === "--niches") {
      args.niches = argv[++i].split(",").map((n) => n.trim()).filter(Boolean);
    } else if (argv[i] === "--out") {
      args.out = argv[++i];
    } else if (argv[i] === "--states") {
      args.states = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const states = args.states?.length ? args.states : Object.keys(CITIES_BY_STATE);

const queries = [];
for (const state of states) {
  const cities = CITIES_BY_STATE[state];
  if (!cities) {
    console.warn(`Unknown state code "${state}", skipping.`);
    continue;
  }
  for (const city of cities) {
    for (const niche of args.niches) {
      queries.push(`${niche} in ${city}, ${state}`);
    }
  }
}

fs.writeFileSync(args.out, JSON.stringify(queries, null, 2), "utf8");
console.log(
  `Wrote ${queries.length} location queries (${args.niches.length} niche(s) x ${queries.length / args.niches.length} city entries) across ${states.length} state(s) to ${args.out}`
);
