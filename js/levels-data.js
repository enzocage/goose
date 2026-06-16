/* ═══ WORLD THEMES, PRE-MADE LEVELS & BUILT-IN DEMO LEVEL ═══ */

export const WORLDS = [
  { name:'Foundations', color:'#ff6600', accent:'#ff8844', bg:'#0a0a16' },
  { name:'Fractures',   color:'#ff4455', accent:'#ff6677', bg:'#0f0a0a' },
  { name:'Mechanisms',  color:'#44aaff', accent:'#66ccff', bg:'#0a0f16' },
  { name:'Conduits',    color:'#bb66ff', accent:'#cc88ff', bg:'#0f0a16' },
  { name:'Mastery',     color:'#ffaa00', accent:'#ffcc44', bg:'#0f0f0a' },
];

// Pre-made levels now live as standalone files in /level (1.json, 2.json, …)
// and are fetched at startup — see loadLevelManifest() in main.js.

export const DEMO_LEVEL = {
  name: '★ Element Showcase',
  world: 2,
  par: 60,
  start: [0, 0, 0],
  exit: [44, 0, 8],
  blocks: [
    // 1) Basics
    [0,0,0,'normal',{}],[1,0,0,'normal',{}],[2,0,0,'normal',{}],[3,0,0,'normal',{}],
    // 2) Fragile crossing (breaks behind you)
    [4,0,0,'fragile',{}],[5,0,0,'fragile',{}],
    [6,0,0,'normal',{}],
    // 3) Ice slide (auto-slides until solid ground)
    [7,0,0,'ice',{}],[8,0,0,'ice',{}],[9,0,0,'ice',{}],[10,0,0,'ice',{}],
    [11,0,0,'normal',{}],
    // 4) Switch toggles the bridge gap
    [12,0,0,'switch',{}],
    [13,0,0,'bridge',{}],[14,0,0,'bridge',{}],
    [15,0,0,'normal',{}],
    // 5) Climbing stairs up to a plateau and back down
    [16,0,0,'normal',{}],[16,1,0,'normal',{}],
    [17,0,0,'normal',{}],[17,1,0,'normal',{}],[17,2,0,'normal',{}],
    [18,0,0,'normal',{}],[18,1,0,'normal',{}],[18,2,0,'normal',{}],
    [19,0,0,'normal',{}],[19,1,0,'normal',{}],
    [20,0,0,'normal',{}],
    // 6) Crate push onto pressure plate opens the gate bridges
    [20,0,1,'normal',{}],[20,0,2,'normal',{}],[20,0,3,'normal',{}],
    [20,0,4,'pressureplate',{}],
    [20,1,2,'pushable',{}],
    [21,0,3,'bridge',{}],[22,0,3,'bridge',{}],
    [23,0,3,'normal',{}],
    // 7) Moving platform ferry across the gap
    [24,0,3,'moving',{ targetX:26, targetY:0, targetZ:3, speed:1.2 }],
    [27,0,3,'normal',{}],
    // 8) Shaker blocks (crumble!) with danger spikes alongside
    [28,0,3,'shaker',{}],[29,0,3,'shaker',{}],
    [28,0,2,'danger',{}],[29,0,2,'danger',{}],
    [30,0,3,'normal',{}],
    // 9) Booster speed pad
    [31,0,3,'booster',{}],
    [32,0,3,'normal',{}],[33,0,3,'normal',{}],[34,0,3,'normal',{}],[35,0,3,'normal',{}],
    // 10) Teleporter pair to the mini-cube island
    [36,0,3,'teleporter',{}],
    [36,0,8,'teleporter',{}],
    [37,0,8,'normal',{}],
    // 11) Mini-cube wall climb (2-high wall, mini only)
    [38,0,8,'normal',{}],[38,1,8,'normal',{}],[38,2,8,'normal',{}],
    [39,0,8,'normal',{}],[39,1,8,'normal',{}],
    [40,0,8,'normal',{}],
    // 12) Mini-cube squeeze tunnel under bridges (roof blocks the big cube)
    [41,0,8,'normal',{}],[41,1,8,'bridge',{}],[41,2,8,'normal',{}],
    [42,0,8,'normal',{}],[42,1,8,'bridge',{}],[42,2,8,'normal',{}],
    [43,0,8,'normal',{}],
    // 13) Exit
    [44,0,8,'normal',{}],
  ],
  prisms: [
    [2,0,0,'prism'],[9,0,0,'prism'],[18,2,0,'prism'],[33,0,3,'prism'],[43,0,8,'prism'],
    [37,0,8,'miniprism'],[40,0,8,'miniprism'],
  ],
  links: [
    { type:'switch-trigger', from:'12,0,0', to:'13,0,0' },
    { type:'switch-trigger', from:'12,0,0', to:'14,0,0' },
    { type:'switch-trigger', from:'20,0,4', to:'21,0,3' },
    { type:'switch-trigger', from:'20,0,4', to:'22,0,3' },
    { type:'teleporter-link', k1:'36,0,3', k2:'36,0,8' },
  ],
};
