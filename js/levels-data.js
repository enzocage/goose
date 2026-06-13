/* ═══ WORLD THEMES, PRE-MADE LEVELS & BUILT-IN DEMO LEVEL ═══ */

export const WORLDS = [
  { name:'Foundations', color:'#ff6600', accent:'#ff8844', bg:'#0a0a16' },
  { name:'Fractures',   color:'#ff4455', accent:'#ff6677', bg:'#0f0a0a' },
  { name:'Mechanisms',  color:'#44aaff', accent:'#66ccff', bg:'#0a0f16' },
  { name:'Conduits',    color:'#bb66ff', accent:'#cc88ff', bg:'#0f0a16' },
  { name:'Mastery',     color:'#ffaa00', accent:'#ffcc44', bg:'#0f0f0a' },
];

export const LEVELS = [
  // WORLD 1
  { world:0, name:'First Steps',   par:6,  tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3]], prisms:[[2,0],[4,2]], start:[0,0], exit:[4,3] },
  { world:0, name:'The Bend',      par:8,  tiles:[[0,0],[1,0],[2,0],[3,0],[0,1],[0,2],[0,3],[1,3],[2,3],[3,3]], prisms:[[3,0],[0,1],[3,3]], start:[0,0], exit:[3,3] },
  { world:0, name:'Cross',         par:12, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[2,1],[2,2],[2,3],[2,4],[0,2],[4,2],[0,4],[4,4]], prisms:[[4,0],[0,2],[4,2],[0,4],[4,4]], start:[2,0], exit:[2,4] },
  { world:0, name:'Loop',          par:14, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[5,1],[5,2],[4,2],[3,2],[2,2],[1,2],[0,2],[0,1]], prisms:[[5,0],[5,2],[0,2]], start:[0,0], exit:[0,1] },
  // WORLD 2
  { world:1, name:'Thin Ice',     par:8,  tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0]], fragile:[[2,0],[3,0],[4,0]], prisms:[[0,0],[6,0]], start:[0,0], exit:[6,0] },
  { world:1, name:'Crumbling',    par:10, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[0,1],[1,1],[2,1],[3,1],[4,1],[0,2],[1,2],[2,2],[3,2],[4,2]], fragile:[[1,0],[2,0],[3,0],[1,1],[3,1],[1,2],[3,2]], prisms:[[4,0],[4,1],[4,2]], start:[0,0], exit:[0,2] },
  { world:1, name:'Leap of Faith',par:10, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[0,1],[3,1],[5,1],[0,2],[1,2],[2,2],[3,2],[5,2]], fragile:[[2,0],[3,1],[1,2],[2,2]], prisms:[[4,0],[0,1],[3,2]], start:[0,0], exit:[5,2] },
  { world:1, name:'Overhang',     par:11, tiles:[[0,0],[1,0],[2,0],[3,0],[2,1],[2,2],[2,3],[0,3],[1,3],[3,3],[4,3],[2,4]], fragile:[[2,1],[2,2],[1,3],[3,3]], prisms:[[3,0],[2,3],[2,4]], start:[0,0], exit:[4,3] },
  // WORLD 3
  { world:2, name:'Gateway',       par:9,  tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0]], switches:{a:[1,0]}, bridges:{a:[[4,0],[5,0],[6,0]]}, prisms:[[7,0]], start:[0,0], exit:[7,0] },
  { world:2, name:'Dual Bridge',   par:12, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[0,1],[4,1],[0,2],[4,2],[0,3],[1,3],[2,3],[3,3],[4,3]], switches:{a:[1,0],b:[3,0]}, bridges:{a:[[1,1],[2,1],[3,1]],b:[[1,2],[2,2],[3,2]]}, prisms:[[0,1],[4,2],[0,3],[4,3]], start:[0,0], exit:[2,3] },
  { world:2, name:'Locked In',     par:10, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[0,1],[4,1],[0,2],[4,2],[0,3],[1,3],[2,3],[3,3],[4,3]], switches:{a:[2,0]}, bridges:{a:[[1,1],[2,1],[3,1],[1,2],[2,2],[3,2]]}, prisms:[[4,0],[0,1],[3,3]], start:[0,0], exit:[4,3] },
  { world:2, name:'The Maze',      par:16, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[0,1],[5,1],[0,2],[5,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3]], switches:{a:[4,0],b:[1,3]}, bridges:{a:[[1,1],[2,1],[3,1],[4,1]],b:[[1,2],[2,2],[3,2],[4,2]]}, prisms:[[5,0],[0,1],[5,1],[0,3],[5,3]], start:[0,0], exit:[3,3] },
  // WORLD 4
  { world:3, name:'Portal',        par:10, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0]], teleporters:{a:[[1,0],[6,0]]}, prisms:[[3,0],[7,0]], start:[0,0], exit:[7,0] },
  { world:3, name:'Twin Gates',    par:12, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[0,1],[6,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2]], teleporters:{a:[[3,0],[3,2]],b:[[0,1],[6,1]]}, prisms:[[6,0],[0,2],[6,2]], start:[0,0], exit:[6,2] },
  { world:3, name:'Nexus',         par:14, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[2,1],[2,3]], teleporters:{a:[[5,0],[5,2]],b:[[0,0],[0,2]]}, fragile:[[2,1],[2,3]], prisms:[[2,0],[3,0],[4,0],[2,2],[3,2],[4,2]], start:[1,0], exit:[1,2] },
  { world:3, name:'Conduit',       par:18, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2]], teleporters:{a:[[2,0],[8,2]],b:[[6,0],[0,2]],c:[[1,0],[3,2]]}, prisms:[[4,0],[8,0],[4,2],[8,2]], start:[0,0], exit:[5,2] },
  // WORLD 5
  { world:4, name:'Ice Slide',     par:7,  tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0]], ice:[[2,0],[3,0],[4,0],[5,0],[6,0]], prisms:[[8,0]], start:[0,0], exit:[8,0] },
  { world:4, name:'Gauntlet',      par:16, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[0,1],[5,1],[0,2],[5,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3]], fragile:[[5,0],[5,1],[5,2]], ice:[[0,1],[0,2]], teleporters:{a:[[1,3],[5,0]]}, switches:{a:[4,3]}, bridges:{a:[[1,1],[2,1],[3,1],[4,1]]}, prisms:[[0,0],[5,3],[3,3]], start:[0,0], exit:[2,3] },
  { world:4, name:'Frostburn',     par:15, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[0,1],[5,1],[0,2],[5,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3]], ice:[[0,0],[5,0],[0,2],[5,2]], fragile:[[1,3],[2,3],[3,3],[4,3]], switches:{a:[2,0]}, bridges:{a:[[1,1],[2,1],[3,1],[4,1]]}, prisms:[[5,1],[0,3],[5,3]], start:[0,0], exit:[5,3] },
  { world:4, name:'The Final Goose',par:20, tiles:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[7,1],[7,2],[7,3],[6,3],[5,3],[4,3],[3,3],[2,3],[1,3],[0,3],[0,2],[0,1]], fragile:[[3,0],[4,0],[5,0],[4,3],[3,3],[2,3]], ice:[[7,1],[7,2]], teleporters:{a:[[2,0],[1,3]]}, switches:{a:[7,0]}, bridges:{a:[[5,1],[5,2],[6,1],[6,2],[4,1],[3,1]]}, prisms:[[7,0],[7,3],[0,3],[0,0]], start:[0,0], exit:[0,1] },
];

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
