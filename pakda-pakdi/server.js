require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server: SocketServer } = require('socket.io');

const PORT = process.env.PORT || 3006;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const FUNUTIL_URL = process.env.FUNUTIL_URL || 'http://localhost:3001';
const GAMES_URL = process.env.GAMES_URL || 'http://localhost:3005';

// ═══════════════════════════════════════
//  GAME CONSTANTS (shared with client)
// ═══════════════════════════════════════
const TILE = 32, COLS = 21, ROWS = 15;
const PLAYER_RADIUS = TILE * 0.35;
const WALL = 1, PATH_TILE = 0, SAFE = 2;
const PLAYER_SPEED = 2.5;
const SPEED_BOOST_MULT = 1.6;
const FREEZE_DURATION = 3000, GHOST_DURATION = 3000, SPEED_DURATION = 4000;
const SAFE_DURATION = 3000, CATCH_IMMUNITY = 1500;
const POWERUP_SPAWN_INTERVAL = 7000, MAX_POWERUPS = 3;
const ROUND_DURATION = 90;
const CATCH_SCORE = 20, SURVIVAL_SCORE_PER_SEC = 2;
const TICK_RATE = 20; // server ticks per second
const TICK_MS = 1000 / TICK_RATE;
const MAX_PLAYERS = 6, MIN_PLAYERS = 2;

const MAZE_TEMPLATE = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1],
    [1,0,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,0,1],
    [1,0,1,0,0,0,0,0,1,0,1,0,1,0,0,0,0,0,1,0,1],
    [1,0,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,1,1,1,1,1,1,1,1,0,1,1,1,0,1],
    [1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1],
    [1,0,1,0,1,0,1,1,1,1,1,1,1,1,1,0,1,0,1,0,1],
    [1,0,1,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,1,0,1],
    [1,0,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,0,1],
    [1,0,1,0,0,0,0,0,1,0,1,0,1,0,0,0,0,0,1,0,1],
    [1,0,1,0,1,1,1,0,1,0,1,0,1,0,1,1,1,0,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

const SPAWN_POSITIONS = [
    { col: 1, row: 13 }, { col: 19, row: 1 }, { col: 1, row: 1 },
    { col: 19, row: 13 }, { col: 10, row: 1 }, { col: 10, row: 13 },
];

const POWERUP_TYPES = ['speed', 'freeze', 'ghost'];

// ═══════════════════════════════════════
//  ROOM MANAGEMENT
// ═══════════════════════════════════════
const rooms = new Map(); // roomCode -> Room

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
    while (rooms.has(code));
    return code;
}

function createRoom(hostId, hostName) {
    const code = generateCode();
    const room = {
        code,
        hostId,
        state: 'waiting', // waiting | playing | roundover | finished
        players: [{ id: hostId, name: hostName, colorIdx: 0 }],
        // Game state (populated when game starts)
        game: null,
        tickInterval: null,
    };
    rooms.set(code, room);
    return room;
}

function findRoom(code) { return rooms.get(code.toUpperCase()); }

function removePlayerFromRoom(room, playerId) {
    const p = room.players.find(p => p.id === playerId) || 
              (room.game ? room.game.players.find(gp => gp.id === playerId) : null);
    const disconnectedName = p ? p.name : 'A player';

    room.players = room.players.filter(p => p.id !== playerId);
    if (room.game) {
        const gp = room.game.players.find(p => p.id === playerId);
        if (gp) gp.disconnected = true;
    }
    if (room.players.length === 0) {
        if (room.tickInterval) clearInterval(room.tickInterval);
        rooms.delete(room.code);
        return null;
    }
    if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
    }
    return { room, disconnectedName };
}

// ═══════════════════════════════════════
//  SERVER-SIDE GAME ENGINE
// ═══════════════════════════════════════
function isServerWalkable(px, py, ghostMode, maze) {
    if (ghostMode) {
        const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
        return r >= 0 && r < ROWS && c >= 0 && c < COLS;
    }
    const rad = PLAYER_RADIUS * 0.8;
    const check = (x, y) => {
        const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
        return maze[r][c] !== WALL;
    };
    return check(px - rad, py - rad) && check(px + rad, py - rad) &&
           check(px - rad, py + rad) && check(px + rad, py + rad);
}

function snapToPath(px, py, maze) {
    if (isServerWalkable(px, py, false, maze)) return { x: px, y: py };
    const col = Math.floor(px / TILE), row = Math.floor(py / TILE);
    for (let r = 0; r < Math.max(COLS, ROWS); r++) {
        for (let dr = -r; dr <= r; dr++) {
            for (let dc = -r; dc <= r; dc++) {
                if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue;
                const nr = row + dr, nc = col + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && maze[nr][nc] !== WALL) {
                    return { x: nc * TILE + TILE / 2, y: nr * TILE + TILE / 2 };
                }
            }
        }
    }
    return { x: px, y: py };
}

function initGameState(room) {
    const maze = MAZE_TEMPLATE.map(r => [...r]);
    const coins = [];
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (maze[r][c] === PATH_TILE && Math.random() < 0.25)
                coins.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, collected: false });

    const gamePlayers = room.players.map((p, i) => ({
        id: p.id, name: p.name, colorIdx: p.colorIdx,
        x: 0, y: 0, role: 'runner',
        score: 0, inputDx: 0, inputDy: 0,
        powerup: null, powerupTimer: 0,
        safeTimer: 0, isSafe: false,
        catchImmunity: 0, disconnected: false,
    }));

    room.game = {
        maze, coins, powerups: [],
        players: gamePlayers,
        currentRound: 0,
        totalRounds: gamePlayers.length,
        roundStartTime: 0,
        lastPowerupSpawn: 0,
        lastScoreTick: 0,
    };
}

function startRound(room, io) {
    const g = room.game;
    g.currentRound++;
    g.coins.forEach(c => c.collected = false); // reset coins
    g.powerups = [];
    g.lastScoreTick = 0;

    const catcherIdx = g.currentRound - 1;
    for (let i = 0; i < g.players.length; i++) {
        const p = g.players[i];
        p.role = (i === catcherIdx) ? 'catcher' : 'runner';
        p.powerup = null; p.powerupTimer = 0;
        p.isSafe = false; p.safeTimer = 0;
        p.catchImmunity = 0;
        p.inputDx = 0; p.inputDy = 0;
        const sp = SPAWN_POSITIONS[i % SPAWN_POSITIONS.length];
        p.x = sp.col * TILE + TILE / 2;
        p.y = sp.row * TILE + TILE / 2;
    }

    g.roundStartTime = Date.now();
    g.lastPowerupSpawn = Date.now();
    room.state = 'playing';

    io.to(room.code).emit('roundStart', {
        round: g.currentRound,
        totalRounds: g.totalRounds,
        players: serializePlayers(g.players),
        catcherId: g.players[catcherIdx].id,
    });

    // Start tick loop
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.tickInterval = setInterval(() => serverTick(room, io), TICK_MS);
}

function serverTick(room, io) {
    const g = room.game;
    if (room.state !== 'playing') return;
    const now = Date.now();

    // Move players
    for (const p of g.players) {
        if (p.disconnected) continue;
        const frozen = isPlayerFrozen(p, g.players);
        if (frozen) continue;

        const speed = getSpeed(p);
        const ghost = p.powerup === 'ghost' && p.powerupTimer > now;
        const dx = p.inputDx, dy = p.inputDy;
        const s = speed * (TICK_MS / (1000 / 60)); // normalize to 60fps equivalent

        const nx = p.x + dx * s;
        if (isServerWalkable(nx, p.y, ghost, g.maze)) p.x = nx;
        const ny = p.y + dy * s;
        if (isServerWalkable(p.x, ny, ghost, g.maze)) p.y = ny;

        // Safe zone (runners only)
        if (p.role === 'runner') {
            const r = Math.floor(p.y / TILE), c = Math.floor(p.x / TILE);
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && g.maze[r][c] === SAFE && !p.isSafe) {
                p.isSafe = true; p.safeTimer = now + SAFE_DURATION;
            }
            if (p.isSafe && now > p.safeTimer) p.isSafe = false;
        } else {
            p.isSafe = false;
        }

        // Collect coins
        for (const coin of g.coins) {
            if (!coin.collected && Math.hypot(coin.x - p.x, coin.y - p.y) < TILE * 0.4) {
                coin.collected = true; p.score += 10;
            }
        }

        // Collect powerups
        for (let i = g.powerups.length - 1; i >= 0; i--) {
            const pu = g.powerups[i];
            if (Math.hypot(pu.x - p.x, pu.y - p.y) < TILE * 0.5) {
                p.powerup = pu.type;
                const dur = { speed: SPEED_DURATION, freeze: FREEZE_DURATION, ghost: GHOST_DURATION };
                p.powerupTimer = now + dur[pu.type];
                g.powerups.splice(i, 1);
            }
        }

        // Clear expired powerup
        if (p.powerup && now > p.powerupTimer) {
            if (p.powerup === 'ghost' && !isServerWalkable(p.x, p.y, false, g.maze)) {
                const snapped = snapToPath(p.x, p.y, g.maze);
                p.x = snapped.x; p.y = snapped.y;
            }
            p.powerup = null; p.powerupTimer = 0;
        }
    }

    // Catch detection
    const catcher = g.players.find(p => p.role === 'catcher' && !p.disconnected);
    if (catcher) {
        for (const runner of g.players.filter(p => p.role === 'runner' && !p.disconnected)) {
            if (runner.isSafe) continue;
            if (runner.catchImmunity && now < runner.catchImmunity) continue;
            if (catcher.catchImmunity && now < catcher.catchImmunity) continue;
            const dist = Math.hypot(catcher.x - runner.x, catcher.y - runner.y);
            if (dist < PLAYER_RADIUS * 1.6) {
                catcher.score += CATCH_SCORE;
                catcher.role = 'runner';
                runner.role = 'catcher';
                runner.catchImmunity = now + CATCH_IMMUNITY;
                runner.powerup = null; runner.powerupTimer = 0;
                catcher.powerup = null; catcher.powerupTimer = 0;
                catcher.isSafe = false; runner.isSafe = false;
                io.to(room.code).emit('catch', { newCatcherId: runner.id, oldCatcherId: catcher.id, catcherName: runner.name });
                break;
            }
        }
    }

    // Survival scoring (every second)
    if (now - g.lastScoreTick >= 1000) {
        g.lastScoreTick = now;
        for (const p of g.players) {
            if (p.role === 'runner' && !p.disconnected) p.score += SURVIVAL_SCORE_PER_SEC;
        }
    }

    // Spawn powerups
    if (now - g.lastPowerupSpawn > POWERUP_SPAWN_INTERVAL) {
        g.lastPowerupSpawn = now;
        if (g.powerups.length < MAX_POWERUPS) {
            const empty = [];
            for (let r = 0; r < ROWS; r++)
                for (let c = 0; c < COLS; c++)
                    if (g.maze[r][c] === PATH_TILE) {
                        const px = c * TILE + TILE / 2, py = r * TILE + TILE / 2;
                        let ok = true;
                        for (const p of g.players) if (Math.hypot(px - p.x, py - p.y) < TILE * 3) { ok = false; break; }
                        if (ok) empty.push({ x: px, y: py });
                    }
            if (empty.length) {
                const cell = empty[Math.floor(Math.random() * empty.length)];
                const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
                g.powerups.push({ x: cell.x, y: cell.y, type });
            }
        }
    }

    // Round timer
    const elapsed = (now - g.roundStartTime) / 1000;
    if (elapsed >= ROUND_DURATION) {
        endRound(room, io);
        return;
    }

    // Broadcast state
    io.to(room.code).emit('gameState', {
        players: serializePlayers(g.players),
        coins: g.coins,
        powerups: g.powerups,
        timeRemaining: Math.max(0, Math.ceil(ROUND_DURATION - elapsed)),
    });
}

function endRound(room, io) {
    if (room.tickInterval) { clearInterval(room.tickInterval); room.tickInterval = null; }
    const g = room.game;

    if (g.currentRound >= g.totalRounds) {
        room.state = 'finished';
        io.to(room.code).emit('gameOver', { players: serializePlayers(g.players) });
    } else {
        room.state = 'roundover';
        const nextCatcher = g.players[g.currentRound];
        io.to(room.code).emit('roundOver', {
            round: g.currentRound,
            players: serializePlayers(g.players),
            nextCatcherName: nextCatcher ? nextCatcher.name : '',
        });
    }
}

function checkGameEnd(room, io) {
    if (room.game && room.state === 'playing') {
        const active = room.game.players.filter(p => !p.disconnected);
        if (active.length <= 1) {
            // FORCE GAME OVER by skipping to the last round
            room.game.currentRound = room.game.totalRounds;
            endRound(room, io);
        }
    }
}

function getSpeed(p) {
    const now = Date.now();
    return (p.powerup === 'speed' && p.powerupTimer > now) ? PLAYER_SPEED * SPEED_BOOST_MULT : PLAYER_SPEED;
}

function isPlayerFrozen(p, allPlayers) {
    const now = Date.now();
    for (const other of allPlayers) {
        if (other.id === p.id || other.disconnected) continue;
        if (other.powerup === 'freeze' && other.powerupTimer > now && other.role !== p.role) return true;
    }
    return false;
}

function serializePlayers(players) {
    return players.map(p => ({
        id: p.id, name: p.name, colorIdx: p.colorIdx,
        x: p.x, y: p.y, role: p.role, score: p.score,
        powerup: p.powerup,
        powerupActive: p.powerup && p.powerupTimer > Date.now(),
        powerupRemaining: p.powerup ? Math.max(0, Math.ceil((p.powerupTimer - Date.now()) / 1000)) : 0,
        isSafe: p.isSafe,
        safeRemaining: p.isSafe ? Math.max(0, Math.ceil((p.safeTimer - Date.now()) / 1000)) : 0,
        disconnected: p.disconnected || false,
    }));
}

// ═══════════════════════════════════════
//  HTML
// ═══════════════════════════════════════
function escapeHtml(str = '') {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function gamePage(baseUrl = BASE_URL) {
    const schema = {
        '@context': 'https://schema.org', '@type': 'WebApplication',
        name: 'Pakda Pakdi — FunUtil Games', url: baseUrl,
        description: 'Play Pakda Pakdi online — a thrilling chase game inspired by the classic Indian street game.',
        applicationCategory: 'GameApplication', operatingSystem: 'Any',
        isPartOf: { '@type': 'WebSite', name: 'FunUtil', url: FUNUTIL_URL }
    };

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>Pakda Pakdi — Chase Game | FunUtil Games</title>
  <meta name="description" content="Play Pakda Pakdi online — a thrilling chase game inspired by the classic Indian street game. Dodge the catcher, grab power-ups, survive as long as you can!" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${escapeHtml(baseUrl)}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Pakda Pakdi — Online Chase Game" />
  <meta property="og:description" content="Play the classic Indian chase game online. Dodge, run & survive!" />
  <meta property="og:url" content="${escapeHtml(baseUrl)}/" />
  <meta property="og:image" content="${escapeHtml(baseUrl)}/og-image.svg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="FunUtil Games" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#0a0a1a" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏃</text></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@700;800;900&display=swap" />
  <link rel="stylesheet" href="/public/style.css?v=4" />
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7863489646399489" crossorigin="anonymous"></script>
</head>
<body>
  <div class="site-wrapper">
    <nav class="navbar">
      <a href="${escapeHtml(GAMES_URL)}" class="navbar-back" title="Back to Games">← Games</a>
      <a href="/" class="navbar-brand"><span>🏃</span> Pakda Pakdi</a>
    </nav>

    <main class="game-container">
      <!-- Menu Screen -->
      <div id="menu-screen" class="screen active">
        <div class="menu-card">
          <div class="menu-emoji">🏃</div>
          <h1 class="menu-title">Pakda <span class="highlight">Pakdi</span></h1>
          <p class="menu-sub">Dodge the catcher, grab power-ups & survive!</p>
          <button id="btn-practice" class="btn btn-primary">🤖 Practice vs Bots</button>
          <button id="btn-multiplayer" class="btn btn-primary" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);">🌐 Online Multiplayer</button>
          <button id="btn-how-to-play" class="btn btn-secondary">❓ How to Play</button>
        </div>
      </div>

      <!-- How to Play -->
      <div id="how-screen" class="screen">
        <div class="how-card">
          <h2 class="how-title">How to Play</h2>
          <div class="how-grid">
            <div class="how-item"><span class="how-icon">🟢</span><div><strong>Runners vs Catcher</strong><p>One player is the catcher (🔴), everyone else runs (🟢). Get caught? You become the new catcher!</p></div></div>
            <div class="how-item"><span class="how-icon">🔄</span><div><strong>Multiple Rounds</strong><p>Each player starts as catcher in one round (90s each). Highest total score wins!</p></div></div>
            <div class="how-item"><span class="how-icon">⭐</span><div><strong>Safe Zones</strong><p>Step on glowing stars for 3s immunity (runners only).</p></div></div>
            <div class="how-item"><span class="how-icon">⚡</span><div><strong>Power-ups for Everyone</strong><p>Both catchers AND runners can grab: <b>⚡ Speed</b> · <b>🧊 Freeze</b> · <b>👻 Ghost</b></p></div></div>
            <div class="how-item"><span class="how-icon">💎</span><div><strong>Scoring</strong><p>Runners: +2/sec. Catcher: +20 per catch. Coins: +10 each.</p></div></div>
            <div class="how-item"><span class="how-icon">🎮</span><div><strong>Controls</strong><p><b>Desktop:</b> Arrow keys / WASD · <b>Mobile:</b> Joystick</p></div></div>
          </div>
          <button id="btn-how-back" class="btn btn-primary">Got it!</button>
        </div>
      </div>

      <!-- Lobby Screen -->
      <div id="lobby-screen" class="screen">
        <div class="menu-card lobby-card">
          <h2 class="menu-title"><span class="highlight">Lobby</span></h2>
          <input type="text" id="player-name" class="lobby-input" placeholder="Your name" maxlength="12" />
          <button id="btn-create-room" class="btn btn-primary">🏠 Create Room</button>
          <div class="lobby-divider"><span>or join a room</span></div>
          <input type="text" id="room-code-input" class="lobby-input" placeholder="Enter room code" maxlength="6" style="text-transform:uppercase;letter-spacing:0.15em;text-align:center;" />
          <button id="btn-join-room" class="btn btn-secondary">🚪 Join Room</button>
          <button id="btn-lobby-back" class="btn btn-secondary" style="margin-top:0.5rem;">← Back</button>
          <p id="lobby-error" class="lobby-error"></p>
        </div>
      </div>

      <!-- Waiting Room Screen -->
      <div id="waiting-screen" class="screen">
        <div class="menu-card lobby-card">
          <h2 class="menu-title">Room: <span class="highlight" id="room-code-display">------</span></h2>
          <button id="btn-copy-code" class="btn btn-secondary btn-small">📋 Copy Room Code</button>
          <div id="player-list" class="player-list"></div>
          <p class="lobby-hint" id="waiting-hint">Waiting for players... (min 2)</p>
          <button id="btn-start-game" class="btn btn-primary" disabled>▶ Start Game</button>
          <button id="btn-leave-room" class="btn btn-secondary">← Leave Room</button>
        </div>
      </div>

      <!-- Game Screen -->
      <div id="game-screen" class="screen">
        <div class="game-hud">
          <div class="hud-item" id="hud-score">Score: 0</div>
          <div class="hud-item" id="hud-round">Round 1/4</div>
          <div class="hud-item" id="hud-timer">90s</div>
          <div class="hud-item" id="hud-powerup"></div>
        </div>
        <canvas id="game-canvas"></canvas>
        <div id="joystick-zone" class="joystick-zone">
          <div id="joystick-base" class="joystick-base">
            <div id="joystick-knob" class="joystick-knob"></div>
          </div>
        </div>
      </div>

      <!-- Round Over -->
      <div id="roundover-screen" class="screen">
        <div class="menu-card scoreboard-card">
          <h2 class="menu-title">Round <span id="round-num" class="highlight">1</span> Over!</h2>
          <div id="round-scores" class="score-list"></div>
          <p class="next-round-info" id="next-round-info"></p>
          <button id="btn-next-round" class="btn btn-primary">▶ Next Round</button>
        </div>
      </div>

      <!-- Final Scoreboard -->
      <div id="final-screen" class="screen">
        <div class="menu-card scoreboard-card">
          <div class="menu-emoji">🏆</div>
          <h2 class="menu-title">Game <span class="highlight">Over!</span></h2>
          <div id="final-scores" class="score-list"></div>
          <button id="btn-play-again" class="btn btn-primary">🔄 Play Again</button>
          <button id="btn-main-menu" class="btn btn-secondary">🏠 Menu</button>
        </div>
      </div>

      <!-- Catch Overlay -->
      <div id="catch-overlay" class="catch-overlay">
        <div class="catch-msg" id="catch-msg">🔄 Role Swap!</div>
      </div>
    </main>

    <footer>
      <p>Made with ❤️ by <strong><a href="${escapeHtml(FUNUTIL_URL)}" class="footer-link">FunUtil</a></strong></p>
    </footer>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/public/game.js?v=4" defer></script>
</body>
</html>`;
}

// ═══════════════════════════════════════
//  HTTP + STATIC FILES
// ═══════════════════════════════════════
function serveStatic(filePath, res) {
    fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        const ext = path.extname(filePath);
        const types = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
            '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream',
            'Cache-Control': ['.png','.jpg','.svg'].includes(ext) ? 'public, max-age=86400' : 'no-cache' });
        res.end(content);
    });
}

function sitemapXml(baseUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseUrl}/</loc><lastmod>${new Date().toISOString()}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url></urlset>`;
}

const server = http.createServer((req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const dynamicBaseUrl = `${protocol}://${host}`;
    const url = new URL(req.url, dynamicBaseUrl);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(`User-agent: *\nAllow: /\nSitemap: ${dynamicBaseUrl}/sitemap.xml\n`); return; }
    if (pathname === '/ads.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('google.com, pub-7863489646399489, DIRECT, f08c47fec0942fa0\n'); return; }
    if (pathname === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(sitemapXml(dynamicBaseUrl)); return; }
    if (pathname === '/og-image.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#0a0a1a"/><stop offset="100%" style="stop-color:#1a1040"/></linearGradient><linearGradient id="txt" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#f97316"/><stop offset="100%" style="stop-color:#ef4444"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><text x="600" y="250" text-anchor="middle" font-family="sans-serif" font-size="80" font-weight="800" fill="url(#txt)">🏃 Pakda Pakdi</text><text x="600" y="340" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#c4b5fd">The Classic Indian Chase Game</text><text x="600" y="420" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#9ca3af">Run · Dodge · Survive — Play Free Online</text></svg>`);
        return;
    }
    if (pathname.startsWith('/public/')) { serveStatic(path.join(__dirname, pathname), res); return; }
    if (pathname === '/' || pathname === '') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(gamePage(dynamicBaseUrl)); return; }
    res.writeHead(404); res.end('Not Found');
});

// ═══════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════
const io = new SocketServer(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('createRoom', (data) => {
        const name = (data.name || 'Player').trim().slice(0, 12);
        const room = createRoom(socket.id, name);
        currentRoom = room;
        socket.join(room.code);
        socket.emit('roomCreated', { code: room.code, players: room.players, hostId: room.hostId });
    });

    socket.on('joinRoom', (data) => {
        const code = (data.code || '').toUpperCase().trim();
        const name = (data.name || 'Player').trim().slice(0, 12);
        const room = findRoom(code);
        if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
        if (room.state !== 'waiting') { socket.emit('error', { message: 'Game already in progress' }); return; }
        if (room.players.length >= MAX_PLAYERS) { socket.emit('error', { message: 'Room is full' }); return; }

        room.players.push({ id: socket.id, name, colorIdx: room.players.length });
        currentRoom = room;
        socket.join(room.code);
        socket.emit('roomJoined', { code: room.code, players: room.players, hostId: room.hostId });
        socket.to(room.code).emit('playerJoined', { players: room.players });
    });

    socket.on('startGame', () => {
        if (!currentRoom || currentRoom.hostId !== socket.id) return;
        if (currentRoom.players.length < MIN_PLAYERS) return;
        if (currentRoom.state !== 'waiting') return;

        initGameState(currentRoom);
        startRound(currentRoom, io);
    });

    socket.on('nextRound', () => {
        if (!currentRoom || currentRoom.hostId !== socket.id) return;
        if (currentRoom.state !== 'roundover') return;
        startRound(currentRoom, io);
    });

    socket.on('input', (data) => {
        if (!currentRoom || !currentRoom.game) return;
        const p = currentRoom.game.players.find(p => p.id === socket.id);
        if (p) {
            p.inputDx = Math.max(-1, Math.min(1, data.dx || 0));
            p.inputDy = Math.max(-1, Math.min(1, data.dy || 0));
        }
    });

    socket.on('playAgain', () => {
        if (!currentRoom || currentRoom.hostId !== socket.id) return;
        currentRoom.state = 'waiting';
        currentRoom.game = null;
        io.to(currentRoom.code).emit('backToWaiting', { players: currentRoom.players, hostId: currentRoom.hostId });
    });

    socket.on('leaveRoom', () => {
        if (currentRoom) {
            socket.leave(currentRoom.code);
            const res = removePlayerFromRoom(currentRoom, socket.id);
            if (res) {
                const { room, disconnectedName } = res;
                io.to(room.code).emit('playerLeft', { players: room.players, hostId: room.hostId, disconnectedName });
                checkGameEnd(room, io);
            }
            currentRoom = null;
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            const res = removePlayerFromRoom(currentRoom, socket.id);
            if (res) {
                const { room, disconnectedName } = res;
                io.to(room.code).emit('playerLeft', { players: room.players, hostId: room.hostId, disconnectedName });
                checkGameEnd(room, io);
            }
            currentRoom = null;
        }
    });
});

if (require.main === module) {
    server.listen(PORT, () => { console.log(`Pakda Pakdi running on ${BASE_URL}`); });
}
module.exports = { server };
