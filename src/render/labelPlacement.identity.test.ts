import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  crowdedMap,
  pairBenchMap,
  placementText,
  randomMap,
  runMap,
  singleBenchMap,
  touchingMap,
  type LabelMap,
} from './labelPlacementMaps';

/*
 * The placement of every label of the bench maps, of a crowded map and of random maps on a half-unit grid, as a
 * digest of the exact numbers (every place, side, rotation and drop). The digests were taken before the collision
 * tests got their fast paths: a change to the speed of the placement must keep them. A change to its rules changes
 * them on purpose; then take the new digests and say why in the commit. The touching maps put an obstacle at the
 * border of each placed box and place again: the tests at the border (touching is free) decide there.
 */
const digest = (map: LabelMap) => {
  const results = runMap(map);
  const placed = results.filter((p) => p && 'centre' in p).length;
  return {
    placed,
    dropped: results.length - placed,
    sha: createHash('sha256').update(placementText(results)).digest('hex').slice(0, 16),
  };
};

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

describe('label placement identity', () => {
  it('places the bench maps and the crowded map as before', () => {
    expect({
      single: digest(singleBenchMap()),
      pairs: digest(pairBenchMap()),
      crowded: digest(crowdedMap()),
    }).toMatchInlineSnapshot(`
      {
        "crowded": {
          "dropped": 569,
          "placed": 561,
          "sha": "e138f2798ae05525",
        },
        "pairs": {
          "dropped": 354,
          "placed": 646,
          "sha": "998734051d5cce4f",
        },
        "single": {
          "dropped": 50,
          "placed": 950,
          "sha": "8ef9c34d8e626e70",
        },
      }
    `);
  });

  it('places random maps as before', () => {
    expect(Object.fromEntries(SEEDS.map((seed) => [seed, digest(randomMap(seed))]))).toMatchInlineSnapshot(`
      {
        "1": {
          "dropped": 14,
          "placed": 52,
          "sha": "ea0e202f66c74820",
        },
        "13": {
          "dropped": 2,
          "placed": 20,
          "sha": "fbc76ec24d37e7be",
        },
        "144": {
          "dropped": 2,
          "placed": 17,
          "sha": "327dd6caaf63ac6d",
        },
        "2": {
          "dropped": 9,
          "placed": 50,
          "sha": "100fcdedc84d7dc6",
        },
        "21": {
          "dropped": 5,
          "placed": 52,
          "sha": "f61cdd2b8370d838",
        },
        "233": {
          "dropped": 1,
          "placed": 14,
          "sha": "e5cee054283449d0",
        },
        "3": {
          "dropped": 6,
          "placed": 44,
          "sha": "8a5fcc7344821a7b",
        },
        "34": {
          "dropped": 7,
          "placed": 31,
          "sha": "129c6e190b9de2aa",
        },
        "5": {
          "dropped": 1,
          "placed": 15,
          "sha": "4e7a3b798903d6fd",
        },
        "55": {
          "dropped": 13,
          "placed": 50,
          "sha": "21efde4a20155402",
        },
        "8": {
          "dropped": 1,
          "placed": 27,
          "sha": "bcbd7d0c0e4513cf",
        },
        "89": {
          "dropped": 2,
          "placed": 20,
          "sha": "0848e149cddae813",
        },
      }
    `);
  });

  it('places random maps with obstacles at the borders of the boxes as before', () => {
    expect(Object.fromEntries(SEEDS.map((seed) => [seed, digest(touchingMap(seed))]))).toMatchInlineSnapshot(`
      {
        "1": {
          "dropped": 17,
          "placed": 48,
          "sha": "667a775fb7baeb15",
        },
        "13": {
          "dropped": 2,
          "placed": 20,
          "sha": "fbc76ec24d37e7be",
        },
        "144": {
          "dropped": 3,
          "placed": 16,
          "sha": "8843fa17e89e66f7",
        },
        "2": {
          "dropped": 11,
          "placed": 48,
          "sha": "190b5b9e1ab98ec7",
        },
        "21": {
          "dropped": 6,
          "placed": 51,
          "sha": "5caacaef9ae9bdae",
        },
        "233": {
          "dropped": 1,
          "placed": 14,
          "sha": "c7a950f06c2ad88f",
        },
        "3": {
          "dropped": 9,
          "placed": 39,
          "sha": "b3298648cdf2b02e",
        },
        "34": {
          "dropped": 8,
          "placed": 30,
          "sha": "462e5cf74bfdd732",
        },
        "5": {
          "dropped": 1,
          "placed": 15,
          "sha": "17b90d060e4e64e8",
        },
        "55": {
          "dropped": 16,
          "placed": 46,
          "sha": "541e29737b0ceace",
        },
        "8": {
          "dropped": 3,
          "placed": 24,
          "sha": "904193470e8e53f0",
        },
        "89": {
          "dropped": 3,
          "placed": 19,
          "sha": "bbaea5104b00f956",
        },
      }
    `);
  });
});
