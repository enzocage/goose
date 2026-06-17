/* ═══════════════════════════════════════════════════════════
   LEVEL NAME GENERATOR
   30 animals × 30 verbs × 30 adjectives = 27 000 unique combinations.
   Each name follows the pattern: "Animal Verb Adjective"
   ═══════════════════════════════════════════════════════════ */

const ANIMALS = [
  'Falcon', 'Raven', 'Otter', 'Viper', 'Lynx', 'Wolf', 'Hawk', 'Fox', 'Bear', 'Moose',
  'Eagle', 'Owl', 'Puma', 'Lion', 'Tiger', 'Shark', 'Cobra', 'Stag', 'Badger', 'Crow',
  'Phoenix', 'Jaguar', 'Hound', 'Crane', 'Rhino', 'Bison', 'Gecko', 'Mantis', 'Vulture', 'Jackal'
];

const VERBS = [
  'Dash', 'Drift', 'Crunch', 'Slide', 'Roar', 'Glide', 'Crawl', 'Dive', 'Leap', 'Climb',
  'Sprint', 'Stomp', 'Swing', 'Float', 'Rush', 'Crash', 'Blaze', 'Skid', 'March', 'Soar',
  'Charge', 'Strike', 'Shred', 'Plunge', 'Sweep', 'Blast', 'Shift', 'Tremble', 'Spark', 'Collide'
];

const ADJECTIVES = [
  'Crimson', 'Silent', 'Jagged', 'Blazing', 'Frozen', 'Shadow', 'Iron', 'Steel', 'Dark', 'Wild',
  'Ancient', 'Broken', 'Hidden', 'Silver', 'Golden', 'Burning', 'Frozen', 'Sacred', 'Twisted', 'Fallen',
  'Crystal', 'Thunder', 'Venom', 'Rusty', 'Solar', 'Phantom', 'Primal', 'Chaos', 'Noble', 'Hollow'
];

/**
 * Returns a randomly generated level name: "Animal Verb Adjective"
 * e.g. "Falcon Dash Crimson" · "Otter Slide Silent"
 */
export function generateRandomLevelName() {
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const verb   = VERBS[Math.floor(Math.random() * VERBS.length)];
  const adj    = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  return `${animal} ${verb} ${adj}`;
}