const GRID_W = 30;
const GRID_H = 18;
const TILE = 40;
const TARGET_DAYS = 20;
const SAVE_KEY = 'pine-frost-save-v1';

const ResourceTypes = ['wood', 'firewood', 'food', 'stone', 'tools', 'fur', 'medicine'];
const JobTypes = ['Idle', 'Woodcutter', 'Gatherer', 'Hunter', 'Builder', 'Hauler', 'FireTender', 'Cook', 'Medic', 'Laborer'];

const BuildingDefs = {
  Shack: { cost: { wood: 12 }, buildTime: 8, heat: 5, storage: 0, housing: 2 },
  Cabin: { cost: { wood: 24, stone: 8 }, buildTime: 14, heat: 10, storage: 0, housing: 4 },
  Campfire: { cost: { wood: 10, firewood: 4 }, buildTime: 5, heat: 18 },
  Bonfire: { cost: { wood: 22, stone: 10, firewood: 6 }, buildTime: 12, heat: 26 },
  FuelDepot: { cost: { wood: 16, stone: 6 }, buildTime: 8, storage: 80 },
  HunterLodge: { cost: { wood: 18, stone: 6 }, buildTime: 10, workers: 2 },
  GathererHut: { cost: { wood: 14 }, buildTime: 8, workers: 2 },
  FoodStorage: { cost: { wood: 18, stone: 4 }, buildTime: 8, storage: 100 },
  LumberCamp: { cost: { wood: 14, tools: 1 }, buildTime: 8, workers: 3 },
  StoneYard: { cost: { wood: 10, stone: 4 }, buildTime: 8, workers: 2 },
  Workshop: { cost: { wood: 20, stone: 8 }, buildTime: 12, workers: 2, heat: 6 },
  StorageHut: { cost: { wood: 10 }, buildTime: 6, storage: 80 },
  Clinic: { cost: { wood: 14, stone: 8, medicine: 2 }, buildTime: 12, workers: 1 },
  Path: { cost: { wood: 1 }, buildTime: 1, infrastructure: true },
};

const WeatherDefs = [
  { name: 'Clear Cold', temp: -12, warmthDrain: 0.5, movePenalty: 1 },
  { name: 'Snowfall', temp: -18, warmthDrain: 0.8, movePenalty: 0.9 },
  { name: 'Heavy Snow', temp: -24, warmthDrain: 1.1, movePenalty: 0.75 },
  { name: 'Blizzard', temp: -32, warmthDrain: 1.6, movePenalty: 0.55 },
];

const state = {
  day: 1,
  hour: 8,
  tick: 0,
  paused: false,
  overlay: 'Normal',
  weatherIndex: 0,
  morale: 60,
  selected: null,
  placementMode: null,
  resources: { wood: 60, firewood: 20, food: 40, stone: 20, tools: 5, fur: 2, medicine: 4 },
  villagers: [],
  nodes: [],
  buildings: [],
  jobs: Object.fromEntries(JobTypes.map((j) => [j, 0])),
  capacity: 200,
  gameOver: false,
};

const els = {
  canvas: document.getElementById('world'),
  resourceBar: document.getElementById('resourceBar'),
  alerts: document.getElementById('alerts'),
  objectives: document.getElementById('objectives'),
  selectedPanel: document.getElementById('selectedPanel'),
  buildButtons: document.getElementById('buildButtons'),
  jobControls: document.getElementById('jobControls'),
  overlayLabel: document.getElementById('overlayLabel'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
};
const ctx = els.canvas.getContext('2d');

function seededRandom(x, y) {
  return Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
}

function initNodes() {
  state.nodes = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const r = seededRandom(x, y);
      if (r > 0.89) state.nodes.push({ x, y, type: 'Forest', amount: 90 });
      else if (r > 0.865) state.nodes.push({ x, y, type: 'Stone', amount: 120 });
      else if (r > 0.85) state.nodes.push({ x, y, type: 'Forage', amount: 70 });
    }
  }
}

function spawnVillagers() {
  const names = ['Avery', 'Nora', 'Mason', 'Leif', 'Iris', 'Piper'];
  state.villagers = names.map((name, i) => ({
    id: i + 1,
    name,
    x: 14 + (i % 2),
    y: 8 + Math.floor(i / 2),
    tx: 14,
    ty: 8,
    job: i < 2 ? 'Woodcutter' : i < 4 ? 'Gatherer' : 'Builder',
    task: 'Starting',
    hunger: 100,
    warmth: 100,
    fatigue: 0,
    health: 100,
    morale: 60,
    sick: false,
    age: i === 0 ? 'Adult' : i === 1 ? 'Adult' : 'Young Adult',
    traits: i % 2 ? ['Hardy'] : ['Efficient'],
  }));
  recalcJobs();
}

function recalcJobs() {
  state.jobs = Object.fromEntries(JobTypes.map((j) => [j, 0]));
  for (const v of state.villagers) state.jobs[v.job] = (state.jobs[v.job] || 0) + 1;
}

function initBuildings() {
  state.buildings = [{ id: 1, type: 'Campfire', x: 14, y: 8, built: true, progress: 1 }];
}

function resetGame() {
  Object.assign(state, {
    day: 1, hour: 8, tick: 0, paused: false, overlay: 'Normal', weatherIndex: 0, morale: 60,
    selected: null, placementMode: null, gameOver: false,
    resources: { wood: 60, firewood: 20, food: 40, stone: 20, tools: 5, fur: 2, medicine: 4 },
    capacity: 200,
  });
  initNodes();
  initBuildings();
  spawnVillagers();
  renderStaticPanels();
}

function canAfford(cost) {
  return Object.entries(cost).every(([res, val]) => (state.resources[res] || 0) >= val);
}

function spend(cost) {
  for (const [res, val] of Object.entries(cost)) state.resources[res] -= val;
}

function addResource(type, amount) {
  state.resources[type] = Math.max(0, Math.floor((state.resources[type] || 0) + amount));
}

function placeBuilding(type, x, y) {
  if (state.buildings.some((b) => b.x === x && b.y === y)) return;
  const def = BuildingDefs[type];
  if (!canAfford(def.cost)) return;
  spend(def.cost);
  state.buildings.push({ id: Date.now() + Math.random(), type, x, y, built: false, progress: 0, workers: 0 });
}

function nearestHeatAt(x, y) {
  let heat = 0;
  for (const b of state.buildings) {
    if (!b.built) continue;
    const def = BuildingDefs[b.type];
    if (!def?.heat) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    heat += Math.max(0, def.heat - d * 3.1);
  }
  return heat;
}

function updateWeather() {
  const escalation = Math.min(3, Math.floor((state.day - 1) / 5));
  const roll = Math.random();
  state.weatherIndex = roll < 0.6 ? escalation : Math.min(3, escalation + 1);
}

function moveToward(v, tx, ty, speed) {
  if (v.x === tx && v.y === ty) return;
  if (Math.abs(tx - v.x) > Math.abs(ty - v.y)) v.x += Math.sign(tx - v.x) * speed;
  else v.y += Math.sign(ty - v.y) * speed;
  v.x = Math.max(0, Math.min(GRID_W - 1, v.x));
  v.y = Math.max(0, Math.min(GRID_H - 1, v.y));
}

function nearestNode(type, fromX, fromY) {
  return state.nodes
    .filter((n) => n.type === type && n.amount > 0)
    .sort((a, b) => Math.hypot(fromX - a.x, fromY - a.y) - Math.hypot(fromX - b.x, fromY - b.y))[0];
}

function processVillager(v) {
  const weather = WeatherDefs[state.weatherIndex];
  const heat = nearestHeatAt(v.x, v.y);
  const shelter = state.buildings.find((b) => b.built && ['Shack', 'Cabin'].includes(b.type) && Math.hypot(b.x - v.x, b.y - v.y) < 2.5);
  const warmthGain = heat > 5 ? 0.9 : shelter ? 0.35 : 0;
  v.warmth -= Math.max(0.15, weather.warmthDrain - warmthGain);
  v.hunger -= 0.22;
  v.fatigue += 0.17;

  if (v.warmth < 18) {
    const warmSpot = state.buildings.find((b) => b.built && (BuildingDefs[b.type].heat || 0) > 0);
    if (warmSpot) {
      v.task = 'Warming up';
      moveToward(v, warmSpot.x, warmSpot.y, weather.movePenalty * 0.38);
      if (Math.hypot(v.x - warmSpot.x, v.y - warmSpot.y) < 1.3) {
        v.warmth += 1.8;
        if (state.resources.firewood > 0 && Math.random() < 0.18) addResource('firewood', -1);
      }
      return;
    }
  }

  if (v.hunger < 30 && state.resources.food > 0) {
    v.task = 'Eating';
    addResource('food', -1);
    v.hunger += 30;
    return;
  }

  if (v.fatigue > 90) {
    const home = state.buildings.find((b) => b.built && ['Shack', 'Cabin'].includes(b.type));
    if (home) moveToward(v, home.x, home.y, 0.3);
    v.task = 'Resting';
    v.fatigue -= 1.1;
    return;
  }

  const speed = 0.4 * weather.movePenalty * (v.warmth < 40 ? 0.7 : 1);

  if (v.job === 'Woodcutter') {
    const n = nearestNode('Forest', v.x, v.y);
    if (n) {
      v.task = 'Chopping wood';
      moveToward(v, n.x, n.y, speed);
      if (Math.hypot(v.x - n.x, v.y - n.y) < 0.9) {
        n.amount -= 0.8;
        addResource('wood', 0.8 + (state.resources.tools > 0 ? 0.3 : 0));
      }
    }
  } else if (v.job === 'Gatherer' || v.job === 'Cook') {
    const n = nearestNode('Forage', v.x, v.y);
    if (n) {
      v.task = 'Foraging';
      moveToward(v, n.x, n.y, speed);
      if (Math.hypot(v.x - n.x, v.y - n.y) < 0.9) {
        n.amount -= 0.7;
        addResource('food', 0.7);
      }
    }
  } else if (v.job === 'Hunter') {
    v.task = 'Hunting';
    addResource('food', 0.22);
  } else if (v.job === 'Builder') {
    const site = state.buildings.find((b) => !b.built);
    if (site) {
      v.task = `Building ${site.type}`;
      moveToward(v, site.x, site.y, speed);
      if (Math.hypot(v.x - site.x, v.y - site.y) < 1) site.progress += 0.008;
    } else v.task = 'Idle (No blueprint)';
  } else if (v.job === 'Hauler' || v.job === 'Laborer') {
    v.task = 'Hauling resources';
    if (state.resources.wood > 0 && state.resources.firewood < 50) {
      addResource('wood', -0.3);
      addResource('firewood', 0.2);
    }
  } else if (v.job === 'Medic') {
    const sick = state.villagers.find((x) => x.sick);
    if (sick && state.resources.medicine > 0) {
      v.task = `Treating ${sick.name}`;
      moveToward(v, sick.x, sick.y, speed);
      if (Math.hypot(v.x - sick.x, v.y - sick.y) < 1.1) {
        addResource('medicine', -0.1);
        sick.health += 0.35;
        sick.sick = false;
      }
    } else {
      v.task = 'Clinic standby';
    }
  } else if (v.job === 'FireTender') {
    v.task = 'Feeding fires';
    if (state.resources.wood > 0 && Math.random() < 0.28) {
      addResource('wood', -0.6);
      addResource('firewood', 0.3);
    }
  } else {
    v.task = 'Idle';
  }

  if (v.warmth <= 0 || v.hunger <= 0) v.health -= 0.5;
  if (v.warmth < 22 && Math.random() < 0.003) v.sick = true;
  if (v.sick) v.health -= 0.08;
  if (v.health <= 0) v.dead = true;
}

function resolveBuildings() {
  for (const b of state.buildings) {
    if (b.built) continue;
    if (b.progress >= 1) {
      b.built = true;
      const def = BuildingDefs[b.type];
      if (def.storage) state.capacity += def.storage;
    }
  }
}

function settlementMorale() {
  const avgWarmth = avg(state.villagers, 'warmth');
  const avgHunger = avg(state.villagers, 'hunger');
  const avgHealth = avg(state.villagers, 'health');
  let score = 50 + (avgWarmth - 50) * 0.25 + (avgHunger - 50) * 0.2 + (avgHealth - 50) * 0.25;
  if (state.resources.food < 10) score -= 10;
  if (state.weatherIndex === 3) score -= 8;
  state.morale = Math.max(0, Math.min(100, Math.round(score)));
}

function avg(list, key) {
  if (!list.length) return 0;
  return list.reduce((s, x) => s + (x[key] || 0), 0) / list.length;
}

function tick() {
  if (state.paused || state.gameOver) return;
  state.tick += 1;

  for (const v of state.villagers) processVillager(v);
  state.villagers = state.villagers.filter((v) => !v.dead);
  resolveBuildings();
  settlementMorale();

  if (state.tick % 20 === 0) {
    state.hour += 1;
    if (state.hour >= 24) {
      state.hour = 0;
      state.day += 1;
      updateWeather();
      for (const v of state.villagers) {
        v.hunger -= 3;
        if (state.resources.food > 0) {
          addResource('food', -1);
          v.hunger += 10;
        }
      }
    }
  }

  const total = Object.values(state.resources).reduce((a, b) => a + b, 0);
  if (total > state.capacity) {
    const spill = total - state.capacity;
    addResource('food', -spill * 0.5);
    addResource('wood', -spill * 0.5);
  }

  if (state.villagers.length === 0) return endGame(false, 'All villagers are gone. Pine Frost has fallen.');
  if (state.day >= TARGET_DAYS && state.resources.food > 30 && state.resources.firewood > 30) {
    return endGame(true, 'Your village stabilized through deep winter. The settlement endures.');
  }
}

function endGame(win, body) {
  state.gameOver = true;
  els.modal.classList.remove('hidden');
  els.modalTitle.textContent = win ? 'Victory: Pine Frost Endures' : 'Defeat: Settlement Lost';
  els.modalBody.textContent = body;
}

function getAlerts() {
  const alerts = [];
  if (state.resources.food < 15) alerts.push('Food stores are low. Assign Gatherers or Hunters.');
  if (state.resources.firewood < 10) alerts.push('Firewood critically low. Heat collapse risk.');
  if (state.villagers.some((v) => v.warmth < 25)) alerts.push('Villagers are freezing. Expand heat coverage.');
  if (state.villagers.some((v) => v.sick)) alerts.push('Sickness detected. Assign a Medic and supply medicine.');
  if (state.weatherIndex >= 2) alerts.push(`${WeatherDefs[state.weatherIndex].name} active. Movement and warmth penalties increased.`);
  if (state.villagers.some((v) => v.job === 'Idle')) alerts.push('Idle villagers available. Reassign jobs.');
  return alerts.slice(0, 8);
}

function objectives() {
  return [
    `Reach Day ${TARGET_DAYS} with food + firewood reserves above 30.`,
    `Current: Day ${state.day} / ${TARGET_DAYS}.`,
    state.resources.firewood >= 30 ? '✅ Firewood reserve established.' : 'Collect and refine firewood for storms.',
    state.buildings.some((b) => b.type === 'Shack' && b.built) ? '✅ Shelter online.' : 'Build a Shack for shelter coverage.',
  ];
}

function renderUI() {
  const weather = WeatherDefs[state.weatherIndex];
  const villagers = state.villagers.length;
  const top = [
    ...ResourceTypes.map((r) => `${r[0].toUpperCase() + r.slice(1)}: ${Math.max(0, Math.floor(state.resources[r]))}`),
    `Population: ${villagers}`,
    `Temp: ${weather.temp}°C`,
    `Weather: ${weather.name}`,
    `Morale: ${state.morale}`,
    `Day ${state.day}, ${String(state.hour).padStart(2, '0')}:00`,
  ];
  els.resourceBar.innerHTML = top.map((m) => `<span class="metric">${m}</span>`).join('');

  els.alerts.innerHTML = getAlerts().map((a) => `<li>${a}</li>`).join('') || '<li>No urgent alerts.</li>';
  els.objectives.innerHTML = objectives().map((o) => `<li>${o}</li>`).join('');
  els.overlayLabel.textContent = `Overlay: ${state.overlay}`;
}

function renderStaticPanels() {
  els.buildButtons.innerHTML = Object.keys(BuildingDefs).map((b) => `<button data-build="${b}">${b}</button>`).join('');
  els.buildButtons.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => (state.placementMode = btn.dataset.build);
  });

  els.jobControls.innerHTML = JobTypes.map((j) => `<div class="job-row"><span>${j}</span><button data-job="${j}" data-delta="-1">-</button><strong id="job-${j}">0</strong><button data-job="${j}" data-delta="1">+</button></div>`).join('');
  els.jobControls.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => changeJobCount(btn.dataset.job, Number(btn.dataset.delta));
  });
}

function changeJobCount(job, delta) {
  const from = state.villagers.find((v) => (delta > 0 ? v.job === 'Idle' : v.job === job));
  if (!from) return;
  from.job = delta > 0 ? job : 'Idle';
  recalcJobs();
}

function renderJobs() {
  for (const job of JobTypes) {
    const node = document.getElementById(`job-${job}`);
    if (node) node.textContent = state.jobs[job] || 0;
  }
}

function nodeColor(type) {
  if (type === 'Forest') return '#276b3d';
  if (type === 'Stone') return '#6f7f95';
  return '#8e55a5';
}

function drawWorld() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const sx = x * TILE;
      const sy = y * TILE;
      const heat = nearestHeatAt(x, y);
      let fill = '#d7ebff';
      if (state.overlay === 'Heat') {
        const heatNorm = Math.min(1, heat / 24);
        const r = Math.floor(50 + 205 * heatNorm);
        const b = Math.floor(230 - 180 * heatNorm);
        fill = `rgb(${r},140,${b})`;
      } else if (state.overlay === 'Danger') {
        fill = heat > 10 ? '#ffcf9f' : '#b8d7ff';
      }
      ctx.fillStyle = fill;
      ctx.fillRect(sx, sy, TILE - 1, TILE - 1);
    }
  }

  for (const n of state.nodes.filter((x) => x.amount > 0)) {
    if (state.overlay === 'Normal' || state.overlay === 'Resources') {
      ctx.fillStyle = nodeColor(n.type);
      ctx.beginPath();
      ctx.arc(n.x * TILE + TILE / 2, n.y * TILE + TILE / 2, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const b of state.buildings) {
    const def = BuildingDefs[b.type];
    ctx.fillStyle = b.built ? '#9a6f44' : '#5f7b9f';
    if (def?.heat) ctx.fillStyle = b.built ? '#f59a3b' : '#7d92b8';
    ctx.fillRect(b.x * TILE + 7, b.y * TILE + 7, TILE - 14, TILE - 14);
    if (!b.built) {
      ctx.strokeStyle = '#f0f6ff';
      ctx.strokeRect(b.x * TILE + 9, b.y * TILE + 9, (TILE - 18) * b.progress, 4);
    }
  }

  for (const v of state.villagers) {
    ctx.fillStyle = v.warmth < 25 ? '#5ba3ff' : v.health < 45 ? '#db6b6b' : '#2f2f2f';
    ctx.beginPath();
    ctx.arc(v.x * TILE + TILE / 2, v.y * TILE + TILE / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (state.placementMode) {
    ctx.fillStyle = 'rgba(248, 156, 63, 0.22)';
    ctx.fillRect(0, 0, 170, 24);
    ctx.fillStyle = '#111';
    ctx.fillText(`Placing: ${state.placementMode}`, 8, 16);
  }
}

function worldCoordsFromEvent(e) {
  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * els.canvas.width / TILE);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * els.canvas.height / TILE);
  return { x: Math.max(0, Math.min(GRID_W - 1, x)), y: Math.max(0, Math.min(GRID_H - 1, y)) };
}

function handleWorldClick(e) {
  const { x, y } = worldCoordsFromEvent(e);
  if (state.placementMode) {
    placeBuilding(state.placementMode, x, y);
    return;
  }
  const villager = state.villagers.find((v) => Math.hypot(v.x - x, v.y - y) < 0.8);
  const building = state.buildings.find((b) => b.x === x && b.y === y);
  const node = state.nodes.find((n) => n.x === x && n.y === y && n.amount > 0);
  state.selected = villager || building || node || null;
  renderSelected();
}

function renderSelected() {
  const s = state.selected;
  if (!s) return (els.selectedPanel.textContent = 'Select a villager, building, or resource node.');
  if (s.name) {
    els.selectedPanel.innerHTML = `<strong>${s.name}</strong> (${s.age})<br/>Job: ${s.job}<br/>Task: ${s.task}<br/>Warmth: ${Math.round(s.warmth)} | Hunger: ${Math.round(s.hunger)} | Health: ${Math.round(s.health)}<br/>Morale: ${Math.round(s.morale)} | Traits: ${s.traits.join(', ')} ${s.sick ? '<span class="tag-warn">(Sick)</span>' : ''}`;
    return;
  }
  if (s.type && BuildingDefs[s.type]) {
    const d = BuildingDefs[s.type];
    els.selectedPanel.innerHTML = `<strong>${s.type}</strong><br/>Status: ${s.built ? 'Active' : `Under Construction (${Math.round(s.progress * 100)}%)`}<br/>Heat: ${d.heat || 0}<br/>Storage: ${d.storage || 0}<br/>Workers: ${d.workers || 0}`;
    return;
  }
  els.selectedPanel.innerHTML = `<strong>${s.type} Node</strong><br/>Estimated yield remaining: ${Math.max(0, Math.round(s.amount))}`;
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  toast('Game saved.');
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return toast('No save found.');
  const data = JSON.parse(raw);
  Object.assign(state, data, { paused: false, gameOver: false });
  renderStaticPanels();
  toast('Save loaded.');
}

function toast(msg) {
  els.selectedPanel.innerHTML = `<span class="tag-ok">${msg}</span>`;
}

function bindUI() {
  els.canvas.addEventListener('click', handleWorldClick);
  document.getElementById('overlayHeat').onclick = () => (state.overlay = state.overlay === 'Heat' ? 'Normal' : 'Heat');
  document.getElementById('overlayResources').onclick = () => (state.overlay = state.overlay === 'Resources' ? 'Normal' : 'Resources');
  document.getElementById('overlayDanger').onclick = () => (state.overlay = state.overlay === 'Danger' ? 'Normal' : 'Danger');
  document.getElementById('pauseBtn').onclick = () => (state.paused = !state.paused);
  document.getElementById('saveBtn').onclick = saveGame;
  document.getElementById('loadBtn').onclick = loadGame;
  document.getElementById('newGameBtn').onclick = resetGame;
  document.getElementById('modalClose').onclick = () => els.modal.classList.add('hidden');
}

function gameLoop() {
  tick();
  renderUI();
  renderJobs();
  renderSelected();
  drawWorld();
  requestAnimationFrame(gameLoop);
}

bindUI();
resetGame();
updateWeather();
gameLoop();
