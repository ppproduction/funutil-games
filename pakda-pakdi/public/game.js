// ═══════════════════════════════════════════
//  Pakda Pakdi — Game Client
//  Dual-mode: Practice (local AI) + Online (Socket.io)
// ═══════════════════════════════════════════

(function () {
    'use strict';

    // ── Constants ──
    const TILE = 32, COLS = 21, ROWS = 15;
    const PLAYER_RADIUS = TILE * 0.35;
    const COIN_RADIUS = 5, POWERUP_RADIUS = 8;
    const FPS = 60, FRAME_TIME = 1000 / FPS;
    const PLAYER_SPEED = 2.5, BOT_SPEED = 2;
    const SPEED_BOOST_MULT = 1.6;
    const FREEZE_DURATION = 3000, GHOST_DURATION = 3000, SPEED_DURATION = 4000;
    const SAFE_DURATION = 3000, CATCH_IMMUNITY = 1500;
    const POWERUP_SPAWN_INTERVAL = 7000, MAX_POWERUPS = 3;
    const ROUND_DURATION = 90;
    const CATCH_SCORE = 20, SURVIVAL_SCORE_PER_SEC = 2;
    const WALL = 1, PATH = 0, SAFE = 2;
    const INPUT_RATE = 50; // send inputs every 50ms
    const LERP_SPEED = 0.25; // interpolation factor (0-1, higher = snappier)

    const BOT_NAMES = ['Raju', 'Priya', 'Kunal'];
    const PLAYER_COLORS = [
        { fill: '#4ade80', stroke: '#22c55e', dark: '#166534' },
        { fill: '#60a5fa', stroke: '#3b82f6', dark: '#1e40af' },
        { fill: '#f472b6', stroke: '#ec4899', dark: '#9d174d' },
        { fill: '#a78bfa', stroke: '#8b5cf6', dark: '#5b21b6' },
        { fill: '#fbbf24', stroke: '#f59e0b', dark: '#92400e' },
        { fill: '#34d399', stroke: '#10b981', dark: '#065f46' },
    ];
    const CATCHER_STYLE = { fill: '#ef4444', stroke: '#dc2626', dark: '#7f1d1d' };

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

    const POWERUP_TYPES = [
        { type: 'speed', emoji: '⚡', color: '#fbbf24' },
        { type: 'freeze', emoji: '🧊', color: '#60a5fa' },
        { type: 'ghost', emoji: '👻', color: '#c084fc' },
    ];

    // ── State ──
    let canvas, ctx;
    let mode = null; // 'practice' | 'online'
    let socket = null;
    let myId = 'human';
    let isHost = false;
    let roomCode = '';

    // Practice-mode local state
    let maze = [];
    let localPlayers = [];
    let coins = [];
    let powerups = [];
    let currentRound = 0, totalRounds = 0;
    let roundStartTime = 0, lastPowerupSpawn = 0, lastScoreTick = 0;
    let gameRunning = false, lastFrameTime = 0;

    // Online-mode server state (received)
    let serverPlayers = [];
    let serverCoins = [];
    let serverPowerups = [];
    let serverTimeRemaining = 90;
    let onlineRound = 0, onlineTotalRounds = 0;

    // Shared
    let keys = {}, joystickDir = { x: 0, y: 0 };
    let offsetX = 0, offsetY = 0, scale = 1;
    let lastInputSend = 0;
    let myPredictedX = null, myPredictedY = null;

    // ═══════════════════════════════════
    //  CANVAS
    // ═══════════════════════════════════
    function initCanvas() {
        canvas = document.getElementById('game-canvas');
        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    function resizeCanvas() {
        const nav = document.querySelector('.navbar');
        const foot = document.querySelector('footer');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight - (nav ? nav.offsetHeight : 0) - (foot ? foot.offsetHeight : 0);
        const mazeW = COLS * TILE, mazeH = ROWS * TILE;
        scale = Math.min(canvas.width / mazeW, canvas.height / mazeH, 2);
        offsetX = (canvas.width - mazeW * scale) / 2;
        offsetY = (canvas.height - mazeH * scale) / 2;
    }

    // ═══════════════════════════════════
    //  MAZE HELPERS
    // ═══════════════════════════════════
    function initMaze() { maze = MAZE_TEMPLATE.map(r => [...r]); }

    function getTile(px, py) {
        const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
        return (r < 0 || r >= ROWS || c < 0 || c >= COLS) ? WALL : maze[r][c];
    }

    function isWalkable(px, py, ghost) {
        if (ghost) { const c = Math.floor(px / TILE), r = Math.floor(py / TILE); return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
        const rad = PLAYER_RADIUS * 0.8;
        return getTile(px-rad,py-rad)!==WALL && getTile(px+rad,py-rad)!==WALL && getTile(px-rad,py+rad)!==WALL && getTile(px+rad,py+rad)!==WALL;
    }

    function snapToPath(px, py) {
        if (isWalkable(px, py, false)) return { x: px, y: py };
        const col = Math.floor(px/TILE), row = Math.floor(py/TILE);
        for (let r = 0; r < Math.max(COLS,ROWS); r++)
            for (let dr = -r; dr <= r; dr++)
                for (let dc = -r; dc <= r; dc++) {
                    if (Math.abs(dr)!==r && Math.abs(dc)!==r) continue;
                    const nr=row+dr, nc=col+dc;
                    if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS && maze[nr][nc]!==WALL)
                        return { x: nc*TILE+TILE/2, y: nr*TILE+TILE/2 };
                }
        return { x: px, y: py };
    }

    function bfs(sc, sr, ec, er) {
        if (sc===ec && sr===er) return [];
        const vis = Array.from({length:ROWS},()=>Array(COLS).fill(false));
        const q = [{col:sc,row:sr,path:[]}]; vis[sr][sc]=true;
        const dirs=[[0,-1],[0,1],[-1,0],[1,0]];
        while (q.length) {
            const {col,row,path}=q.shift();
            if (col===ec && row===er) return path;
            for (const [dc,dr] of dirs) {
                const nc=col+dc, nr=row+dr;
                if (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&!vis[nr][nc]&&maze[nr][nc]!==WALL) {
                    vis[nr][nc]=true; q.push({col:nc,row:nr,path:[...path,{col:nc,row:nr}]});
                }
            }
        }
        return [];
    }

    // ═══════════════════════════════════
    //  INPUT
    // ═══════════════════════════════════
    function getInputDir() {
        let dx=0, dy=0;
        if (keys['ArrowLeft']||keys['KeyA']) dx-=1;
        if (keys['ArrowRight']||keys['KeyD']) dx+=1;
        if (keys['ArrowUp']||keys['KeyW']) dy-=1;
        if (keys['ArrowDown']||keys['KeyS']) dy+=1;
        if (Math.abs(joystickDir.x)>0.2||Math.abs(joystickDir.y)>0.2) { dx=joystickDir.x; dy=joystickDir.y; }
        const len=Math.hypot(dx,dy);
        if (len>0) { dx/=len; dy/=len; }
        return { dx, dy };
    }

    function initInput() {
        document.addEventListener('keydown', e => { keys[e.code]=true;
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault(); });
        document.addEventListener('keyup', e => { keys[e.code]=false; });
        const base=document.getElementById('joystick-base'), knob=document.getElementById('joystick-knob');
        if (!base||!knob) return;
        let dragging=false;
        function handle(cx2,cy2) {
            const rect=base.getBoundingClientRect(), cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
            let dx=cx2-cx, dy=cy2-cy; const maxR=rect.width/2-10, dist=Math.hypot(dx,dy);
            if (dist>maxR) { dx=(dx/dist)*maxR; dy=(dy/dist)*maxR; }
            knob.style.transform=`translate(${dx}px,${dy}px)`; joystickDir.x=dx/maxR; joystickDir.y=dy/maxR;
        }
        function reset() { dragging=false; knob.style.transform='translate(0,0)'; joystickDir.x=0; joystickDir.y=0; }
        base.addEventListener('touchstart', e => { e.preventDefault(); dragging=true; handle(e.touches[0].clientX,e.touches[0].clientY); }, {passive:false});
        document.addEventListener('touchmove', e => { if (!dragging) return; e.preventDefault(); handle(e.touches[0].clientX,e.touches[0].clientY); }, {passive:false});
        document.addEventListener('touchend', reset);
        document.addEventListener('touchcancel', reset);
    }

    // ═══════════════════════════════════
    //  SCREENS
    // ═══════════════════════════════════
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    let overlayTimeout = null;
    function showCatchOverlay(msg) {
        const overlay = document.getElementById('catch-overlay');
        document.getElementById('catch-msg').textContent = msg;
        overlay.classList.add('active');
        if (overlayTimeout) clearTimeout(overlayTimeout);
        overlayTimeout = setTimeout(() => overlay.classList.remove('active'), 1200);
    }

    // ═══════════════════════════════════
    //  DRAWING (shared for both modes)
    // ═══════════════════════════════════
    function drawMaze(mazeData) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const x = c*TILE, y = r*TILE;
                if (mazeData[r][c] === WALL) {
                    ctx.fillStyle='#1e1b4b'; ctx.fillRect(x,y,TILE,TILE);
                    ctx.strokeStyle='#312e81'; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,TILE-1,TILE-1);
                } else if (mazeData[r][c] === SAFE) {
                    ctx.fillStyle='#0f172a'; ctx.fillRect(x,y,TILE,TILE);
                    const a=0.15+0.1*Math.sin(Date.now()/500);
                    ctx.fillStyle=`rgba(251,191,36,${a})`; ctx.fillRect(x,y,TILE,TILE);
                    ctx.font='16px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
                    ctx.fillText('⭐',x+TILE/2,y+TILE/2);
                } else {
                    ctx.fillStyle='#0f172a'; ctx.fillRect(x,y,TILE,TILE);
                }
            }
        }
    }

    function drawCoins(coinList) {
        for (const coin of coinList) {
            if (coin.collected) continue;
            ctx.beginPath(); ctx.arc(coin.x,coin.y,COIN_RADIUS,0,Math.PI*2);
            ctx.fillStyle='#fbbf24'; ctx.fill(); ctx.strokeStyle='#f59e0b'; ctx.lineWidth=1; ctx.stroke();
        }
    }

    function drawPowerups(puList) {
        for (const p of puList) {
            const emoji = typeof p.type === 'string' ? { speed:'⚡', freeze:'🧊', ghost:'👻' }[p.type] : p.emoji;
            const color = typeof p.type === 'string' ? { speed:'#fbbf24', freeze:'#60a5fa', ghost:'#c084fc' }[p.type] : p.color;
            ctx.beginPath(); ctx.arc(p.x,p.y,POWERUP_RADIUS+2*Math.sin(Date.now()/300),0,Math.PI*2);
            ctx.fillStyle=(color||'#fff')+'40'; ctx.fill();
            ctx.font='16px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText(emoji||'?',p.x,p.y);
        }
    }

    function drawPlayers(playerList, selfId) {
        for (const p of playerList) {
            // Completely skip rendering disconnected players
            if (p.disconnected) continue;
            const isCatcher = p.role === 'catcher';
            const color = PLAYER_COLORS[p.colorIdx % PLAYER_COLORS.length]; // always own color
            const ghost = p.powerup === 'ghost' && p.powerupActive;
            const frozen = isPlayerFrozenVisual(p, playerList);

            // Catcher glow ring (pulsing red)
            if (isCatcher) {
                const ga = 0.4 + 0.2 * Math.sin(Date.now() / 200);
                ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_RADIUS + 7, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(239,68,68,${ga})`; ctx.lineWidth = 3; ctx.stroke();
            }
            // Safe shield
            if (p.isSafe) {
                ctx.beginPath(); ctx.arc(p.x,p.y,PLAYER_RADIUS+6,0,Math.PI*2);
                ctx.strokeStyle=`rgba(251,191,36,${0.3+0.15*Math.sin(Date.now()/200)})`; ctx.lineWidth=2; ctx.stroke();
            }
            if (ghost) ctx.globalAlpha=0.5;
            const fc = frozen ? '#93c5fd' : color.fill;
            const sc = frozen ? '#60a5fa' : color.stroke;

            ctx.beginPath(); ctx.arc(p.x,p.y,PLAYER_RADIUS,0,Math.PI*2);
            ctx.fillStyle=fc; ctx.fill(); ctx.strokeStyle=sc; ctx.lineWidth=2; ctx.stroke();
            // Eyes
            ctx.fillStyle = frozen ? '#1e40af' : color.dark;
            ctx.beginPath(); ctx.arc(p.x-4,p.y-3,2,0,Math.PI*2); ctx.arc(p.x+4,p.y-3,2,0,Math.PI*2); ctx.fill();
            // Mouth (angry for catcher, smile for runner)
            ctx.beginPath();
            if (isCatcher) ctx.arc(p.x,p.y+2,3.5,0,Math.PI);
            else ctx.arc(p.x,p.y+4,3.5,Math.PI,0);
            ctx.strokeStyle = frozen ? '#1e40af' : color.dark; ctx.lineWidth=1.5; ctx.stroke();
            ctx.globalAlpha=1;

            // Name
            ctx.font='9px Inter,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
            ctx.fillStyle = isCatcher ? '#fca5a5' : '#bbf7d0';
            const label = p.id === selfId ? `⭐ ${p.name}` : p.name;
            ctx.fillText(label, p.x, p.y-PLAYER_RADIUS-4);
        }
    }

    function isPlayerFrozenVisual(p, allPlayers) {
        for (const o of allPlayers) {
            if (o.id === p.id) continue;
            if (o.powerup === 'freeze' && o.powerupActive && o.role !== p.role) return true;
        }
        return false;
    }

    // ═══════════════════════════════════
    //  SCOREBOARD RENDERING
    // ═══════════════════════════════════
    function renderScoreList(containerId, playerList, selfId, showMedals) {
        const sorted = [...playerList].sort((a,b) => b.score - a.score);
        document.getElementById(containerId).innerHTML = sorted.map((p, i) => {
            const medal = showMedals ? (i===0?'🏆 ':i===1?'🥈 ':i===2?'🥉 ':'') : '';
            const color = PLAYER_COLORS[p.colorIdx % PLAYER_COLORS.length].fill;
            const isSelf = p.id === selfId;
            const discClass = p.disconnected ? ' style="opacity: 0.5;"' : '';
            const discLabel = p.disconnected ? ' <span style="color:#ef4444;font-size:0.75rem;">(Left)</span>' : '';
            return `<div class="score-row${i===0?' winner':''}"${discClass}>
                <span class="score-name">${medal}<span class="score-dot" style="background:${color}"></span>${isSelf?'⭐ ':''}${p.name}${discLabel}</span>
                <span class="score-value">${p.score}</span>
            </div>`;
        }).join('');
    }

    // ═══════════════════════════════════
    //  PRACTICE MODE (local engine)
    // ═══════════════════════════════════
    function startPractice() {
        mode = 'practice'; myId = 'human';
        localPlayers = [
            makePlayer('human', 'You', 0, false),
            makePlayer('bot0', BOT_NAMES[0], 1, true),
            makePlayer('bot1', BOT_NAMES[1], 2, true),
            makePlayer('bot2', BOT_NAMES[2], 3, true),
        ];
        totalRounds = localPlayers.length;
        currentRound = 0;
        startLocalRound();
    }

    function makePlayer(id, name, colorIdx, isBot) {
        return { id, name, colorIdx, isBot, x:0, y:0, role:'runner', score:0,
            powerup:null, powerupTimer:0, powerupActive:false, powerupRemaining:0,
            safeTimer:0, isSafe:false, safeRemaining:0, catchImmunity:0, disconnected:false, _path:[] };
    }

    function startLocalRound() {
        currentRound++;
        initMaze(); coins = []; powerups = [];
        for (let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
            if (maze[r][c]===PATH && Math.random()<0.25)
                coins.push({x:c*TILE+TILE/2, y:r*TILE+TILE/2, collected:false});
        lastScoreTick=0;
        const ci = currentRound-1;
        for (let i=0;i<localPlayers.length;i++) {
            const p=localPlayers[i];
            p.role = i===ci ? 'catcher' : 'runner';
            p.powerup=null; p.powerupTimer=0; p.powerupActive=false;
            p.isSafe=false; p.safeTimer=0; p.catchImmunity=0; p._path=[];
            const sp=SPAWN_POSITIONS[i%SPAWN_POSITIONS.length];
            p.x=sp.col*TILE+TILE/2; p.y=sp.row*TILE+TILE/2;
        }
        roundStartTime=Date.now(); lastPowerupSpawn=Date.now(); lastFrameTime=0; gameRunning=true;
        showScreen('game-screen'); resizeCanvas();
        requestAnimationFrame(practiceLoop);
    }

    function practiceLoop(ts) {
        if (!gameRunning || mode !== 'practice') return;
        const dt = ts - lastFrameTime || FRAME_TIME;
        lastFrameTime = ts;
        const cdt = Math.min(dt, FRAME_TIME*3);
        const now = Date.now();

        // Update all players
        for (const p of localPlayers) {
            if (p.isBot) updateBot(p, cdt);
            // Safe zone
            if (p.role==='runner') {
                if (getTile(p.x,p.y)===SAFE && !p.isSafe) { p.isSafe=true; p.safeTimer=now+SAFE_DURATION; }
                if (p.isSafe && now>p.safeTimer) p.isSafe=false;
            } else { p.isSafe=false; }
            p.safeRemaining = p.isSafe ? Math.max(0,Math.ceil((p.safeTimer-now)/1000)) : 0;
            // Collect coins
            for (const coin of coins)
                if (!coin.collected && Math.hypot(coin.x-p.x,coin.y-p.y)<TILE*0.4) { coin.collected=true; p.score+=10; }
            // Collect powerups
            for (let i=powerups.length-1;i>=0;i--) {
                const pu=powerups[i];
                if (Math.hypot(pu.x-p.x,pu.y-p.y)<TILE*0.5) {
                    p.powerup=pu.type; p.powerupTimer=now+{speed:SPEED_DURATION,freeze:FREEZE_DURATION,ghost:GHOST_DURATION}[pu.type];
                    powerups.splice(i,1);
                }
            }
            // Expire powerup
            p.powerupActive = p.powerup && now < p.powerupTimer;
            p.powerupRemaining = p.powerup ? Math.max(0,Math.ceil((p.powerupTimer-now)/1000)) : 0;
            if (p.powerup && now>p.powerupTimer) {
                if (p.powerup==='ghost' && !isWalkable(p.x,p.y,false)) { const s=snapToPath(p.x,p.y); p.x=s.x; p.y=s.y; }
                p.powerup=null; p.powerupTimer=0; p.powerupActive=false;
            }
        }

        // Human movement
        const human = localPlayers.find(p=>p.id==='human');
        if (human && !isLocalFrozen(human)) {
            const {dx,dy}=getInputDir();
            const speed=getLocalSpeed(human)*(cdt/FRAME_TIME);
            const ghost=human.powerup==='ghost'&&human.powerupActive;
            const nx=human.x+dx*speed; if (isWalkable(nx,human.y,ghost)) human.x=nx;
            const ny=human.y+dy*speed; if (isWalkable(human.x,ny,ghost)) human.y=ny;
        }

        // Catch detection
        const catcher = localPlayers.find(p=>p.role==='catcher');
        if (catcher) {
            for (const runner of localPlayers.filter(p=>p.role==='runner')) {
                if (runner.isSafe || (runner.catchImmunity && now<runner.catchImmunity) || (catcher.catchImmunity && now<catcher.catchImmunity)) continue;
                if (Math.hypot(catcher.x-runner.x, catcher.y-runner.y) < PLAYER_RADIUS*1.6) {
                    catcher.score+=CATCH_SCORE; catcher.role='runner'; runner.role='catcher';
                    runner.catchImmunity=now+CATCH_IMMUNITY;
                    runner.powerup=null; runner.powerupTimer=0; catcher.powerup=null; catcher.powerupTimer=0;
                    catcher.isSafe=false; runner.isSafe=false;
                    showCatchOverlay(`🔄 ${runner.name} is now the Catcher!`);
                    break;
                }
            }
        }

        // Survival scoring
        if (now-lastScoreTick>=1000) { lastScoreTick=now; for (const p of localPlayers) if (p.role==='runner') p.score+=SURVIVAL_SCORE_PER_SEC; }

        // Spawn powerups
        if (now-lastPowerupSpawn>POWERUP_SPAWN_INTERVAL) { lastPowerupSpawn=now; localSpawnPowerup(); }

        // Round timer
        const elapsed=(now-roundStartTime)/1000;
        if (elapsed>=ROUND_DURATION) { endLocalRound(); return; }

        // Draw
        drawFrame(maze, coins, powerups, localPlayers, myId, currentRound, totalRounds, Math.max(0,Math.ceil(ROUND_DURATION-elapsed)));
        requestAnimationFrame(practiceLoop);
    }

    function endLocalRound() {
        gameRunning=false;
        if (currentRound>=totalRounds) {
            renderScoreList('final-scores', localPlayers, myId, true);
            showScreen('final-screen');
        } else {
            document.getElementById('round-num').textContent=currentRound;
            renderScoreList('round-scores', localPlayers, myId, false);
            const next=localPlayers[currentRound];
            document.getElementById('next-round-info').textContent=`Next round: ${next.name} starts as Catcher`;
            showScreen('roundover-screen');
        }
    }

    // Practice helpers
    function getLocalSpeed(p) { return ((p.isBot?BOT_SPEED:PLAYER_SPEED) * (p.powerup==='speed'&&p.powerupActive ? SPEED_BOOST_MULT : 1)); }
    function isLocalFrozen(p) {
        for (const o of localPlayers) { if (o.id===p.id) continue; if (o.powerup==='freeze'&&o.powerupActive&&o.role!==p.role) return true; } return false;
    }

    function updateBot(bot, dt) {
        if (isLocalFrozen(bot)) return;
        const col=Math.floor(bot.x/TILE), row=Math.floor(bot.y/TILE);
        if (bot.role==='catcher') {
            let near=null, nd=Infinity;
            for (const p of localPlayers) { if (p.role!=='runner') continue; const d=Math.hypot(p.x-bot.x,p.y-bot.y); if (d<nd){nd=d;near=p;} }
            if (near && (!bot._path||!bot._path.length||Math.random()<0.08))
                bot._path=bfs(col,row,Math.floor(near.x/TILE),Math.floor(near.y/TILE));
        } else {
            const cat=localPlayers.find(p=>p.role==='catcher');
            if (cat) {
                const d=Math.hypot(cat.x-bot.x,cat.y-bot.y);
                if (d<TILE*6||!bot._path||!bot._path.length) {
                    let best=null,bd=0; const cc=Math.floor(cat.x/TILE),cr=Math.floor(cat.y/TILE);
                    for(let r=1;r<ROWS-1;r+=2) for(let c=1;c<COLS-1;c+=2)
                        if(maze[r][c]!==WALL){const dd=Math.hypot(c-cc,r-cr); if(dd>bd){bd=dd;best={col:c,row:r};}}
                    if(best) bot._path=bfs(col,row,best.col,best.row);
                }
            }
        }
        if (bot._path&&bot._path.length) {
            const next=bot._path[0], tx=next.col*TILE+TILE/2, ty=next.row*TILE+TILE/2;
            const dx=tx-bot.x, dy=ty-bot.y, dist=Math.hypot(dx,dy);
            const speed=getLocalSpeed(bot)*(dt/FRAME_TIME);
            const ghost=bot.powerup==='ghost'&&bot.powerupActive;
            if (dist<2) { bot.x=tx; bot.y=ty; bot._path.shift(); }
            else { const nx=bot.x+(dx/dist)*speed; const ny=bot.y+(dy/dist)*speed;
                if(isWalkable(nx,bot.y,ghost)) bot.x=nx; if(isWalkable(bot.x,ny,ghost)) bot.y=ny; }
        }
    }

    function localSpawnPowerup() {
        if (powerups.length>=MAX_POWERUPS) return;
        const empty=[];
        for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(maze[r][c]===PATH){
            const px=c*TILE+TILE/2, py=r*TILE+TILE/2;
            let ok=true; for(const p of localPlayers) if(Math.hypot(px-p.x,py-p.y)<TILE*3){ok=false;break;}
            if(ok) empty.push({x:px,y:py});
        }
        if(!empty.length) return;
        const cell=empty[Math.floor(Math.random()*empty.length)];
        const info=POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
        powerups.push({x:cell.x,y:cell.y,...info});
    }

    // ═══════════════════════════════════
    //  ONLINE MODE (Socket.io)
    // ═══════════════════════════════════
    function initSocket() {
        if (socket) return;
        socket = io();
        myId = socket.id; // will be set after connect

        socket.on('connect', () => {
            myId = socket.id;
            // If the user already had a room code, they probably got disconnected (e.g., iOS background tab)
            // Attempt to re-join the existing room
            if (roomCode) {
                const playerName = document.getElementById('player-name').value.trim() || 'Player';
                socket.emit('joinRoom', { name: playerName, code: roomCode });
            }
        });

        socket.on('roomCreated', (data) => {
            roomCode = data.code; isHost = true;
            document.getElementById('room-code-display').textContent = data.code;
            updatePlayerList(data.players);
            updateStartButton(data.players.length);
            showScreen('waiting-screen');
        });

        socket.on('roomJoined', (data) => {
            roomCode = data.code; isHost = (data.hostId === socket.id);
            document.getElementById('room-code-display').textContent = data.code;
            updatePlayerList(data.players);
            updateStartButton(data.players.length);
            showScreen('waiting-screen');
        });

        socket.on('playerJoined', (data) => {
            updatePlayerList(data.players);
            updateStartButton(data.players.length);
        });

        socket.on('error', (data) => {
            document.getElementById('lobby-error').textContent = data.message;
            setTimeout(() => { document.getElementById('lobby-error').textContent = ''; }, 3000);
        });

        socket.on('roundStart', (data) => {
            mode = 'online';
            onlineRound = data.round;
            onlineTotalRounds = data.totalRounds;
            serverPlayers = data.players;
            myPredictedX = null;
            myPredictedY = null;
            lastFrameTime = 0;
            initMaze();
            showScreen('game-screen');
            resizeCanvas();
            gameRunning = true;
            requestAnimationFrame(onlineRenderLoop);
        });

        socket.on('gameState', (data) => {
            // Store server target positions for interpolation
            for (const sp of data.players) {
                sp._targetX = sp.x;
                sp._targetY = sp.y;
                // Preserve current render position if we have one
                const existing = serverPlayers.find(p => p.id === sp.id);
                if (existing && existing._renderX !== undefined) {
                    sp._renderX = existing._renderX;
                    sp._renderY = existing._renderY;
                } else {
                    sp._renderX = sp.x;
                    sp._renderY = sp.y;
                }
            }
            serverPlayers = data.players;
            serverCoins = data.coins;
            serverPowerups = data.powerups;
            serverTimeRemaining = data.timeRemaining;
        });

        socket.on('catch', (data) => {
            showCatchOverlay(`🔄 ${data.catcherName} is now the Catcher!`);
        });

        socket.on('roundOver', (data) => {
            gameRunning = false;
            document.getElementById('round-num').textContent = data.round;
            renderScoreList('round-scores', data.players, socket.id, false);
            document.getElementById('next-round-info').textContent = `Next round: ${data.nextCatcherName} starts as Catcher`;

            const nextBtn = document.getElementById('btn-next-round');
            nextBtn.disabled = !isHost;
            nextBtn.textContent = isHost ? '▶ Next Round' : '⏳ Waiting for host...';
            showScreen('roundover-screen');
        });

        socket.on('gameOver', (data) => {
            gameRunning = false;
            renderScoreList('final-scores', data.players, socket.id, true);
            const againBtn = document.getElementById('btn-play-again');
            againBtn.disabled = !isHost;
            againBtn.textContent = isHost ? '🔄 Play Again' : '⏳ Waiting for host...';
            showScreen('final-screen');
        });

        socket.on('backToWaiting', (data) => {
            isHost = (data.hostId === socket.id);
            updatePlayerList(data.players);
            updateStartButton(data.players.length);
            showScreen('waiting-screen');
        });

        socket.on('playerLeft', (data) => {
            // Find who left
            const oldList = Array.from(document.getElementById('player-list').children).map(c => c.textContent.trim());
            
            // Update the waiting room list
            isHost = (data.hostId === socket.id);
            updatePlayerList(data.players);
            updateStartButton(data.players.length);
            
            // Show a notification if game is running
            if (gameRunning && data.disconnectedName) {
                // Determine name by finding who is no longer in data.players
                const activeIds = data.players.map(p => p.id);
                // The server sets p.disconnected = true for left players if game is running
                showCatchOverlay(`🚪 ${data.disconnectedName} left the game`);
            }
        });
    }

    function updatePlayerList(players) {
        const el = document.getElementById('player-list');
        el.innerHTML = players.map((p, i) => {
            const color = PLAYER_COLORS[p.colorIdx % PLAYER_COLORS.length].fill;
            const isMe = p.id === socket.id;
            const hostBadge = p.id === (isHost ? socket.id : players[0]?.id) && i === 0 ? ' 👑' : '';
            return `<div class="player-row"><span class="score-dot" style="background:${color}"></span> ${p.name}${isMe?' (You)':''}${hostBadge}</div>`;
        }).join('');
    }

    function updateStartButton(count) {
        const btn = document.getElementById('btn-start-game');
        btn.disabled = !isHost || count < 2;
        const hint = document.getElementById('waiting-hint');
        if (!isHost) hint.textContent = 'Waiting for host to start...';
        else if (count < 2) hint.textContent = 'Waiting for players... (min 2)';
        else hint.textContent = `${count} players ready!`;
    }

    // Online render loop — interpolates toward server state
    function onlineRenderLoop(ts) {
        if (!gameRunning || mode !== 'online') return;

        const dt = lastFrameTime ? (ts - lastFrameTime) : FRAME_TIME;
        lastFrameTime = ts;

        // Send input to server
        const now = Date.now();
        const { dx, dy } = getInputDir();
        if (now - lastInputSend > INPUT_RATE) {
            lastInputSend = now;
            socket.emit('input', { dx, dy });
        }

        // Interpolate player positions for smooth rendering
        const renderList = serverPlayers.map(p => {
            const isMe = p.id === socket.id;

            if (isMe) {
                // Client-side prediction for local player (60fps buttery smooth)
                if (myPredictedX === null || myPredictedY === null) {
                    myPredictedX = p.x;
                    myPredictedY = p.y;
                }

                // Soft rubberbanding: if server and client diverge too much, snap to server
                if (p._targetX !== undefined && Math.hypot(p._targetX - myPredictedX, p._targetY - myPredictedY) > TILE * 1.5) {
                    myPredictedX = p._targetX;
                    myPredictedY = p._targetY;
                }

                // Predict movement locally if not frozen
                let isFrozen = false;
                for (const o of serverPlayers) {
                    if (o.id !== p.id && o.powerup === 'freeze' && o.role !== p.role) {
                        isFrozen = true; break;
                    }
                }

                if (!isFrozen) {
                    const speed = (p.powerup === 'speed' ? PLAYER_SPEED * SPEED_BOOST_MULT : PLAYER_SPEED) * (dt / FRAME_TIME);
                    const ghost = p.powerup === 'ghost';
                    const nx = myPredictedX + dx * speed;
                    if (isWalkable(nx, myPredictedY, ghost)) myPredictedX = nx;
                    const ny = myPredictedY + dy * speed;
                    if (isWalkable(myPredictedX, ny, ghost)) myPredictedY = ny;
                }

                p._renderX = myPredictedX;
                p._renderY = myPredictedY;

            } else {
                // Smooth interpolation for remote players
                if (p._renderX !== undefined && p._targetX !== undefined) {
                    p._renderX += (p._targetX - p._renderX) * LERP_SPEED;
                    p._renderY += (p._targetY - p._renderY) * LERP_SPEED;
                }
            }

            return { ...p, x: p._renderX !== undefined ? p._renderX : p.x, y: p._renderY !== undefined ? p._renderY : p.y };
        });

        drawFrame(MAZE_TEMPLATE, serverCoins, serverPowerups, renderList, socket.id, onlineRound, onlineTotalRounds, serverTimeRemaining);
        requestAnimationFrame(onlineRenderLoop);
    }

    // ═══════════════════════════════════
    //  UNIFIED DRAW FRAME
    // ═══════════════════════════════════
    function drawFrame(mazeData, coinList, puList, playerList, selfId, round, totalR, timeLeft) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        drawMaze(mazeData);
        drawCoins(coinList);
        drawPowerups(puList);
        drawPlayers(playerList, selfId);
        ctx.restore();

        // HUD
        const me = playerList.find(p => p.id === selfId);
        document.getElementById('hud-score').textContent = `Score: ${me ? me.score : 0}`;
        document.getElementById('hud-round').textContent = `Round ${round}/${totalR}`;
        document.getElementById('hud-timer').textContent = `${timeLeft}s`;
        const hp = document.getElementById('hud-powerup');
        if (me && me.powerup && me.powerupActive) {
            const icons = {speed:'⚡',freeze:'🧊',ghost:'👻'};
            hp.textContent = `${icons[me.powerup]||''} ${me.powerupRemaining||''}s`;
        } else if (me && me.isSafe) {
            hp.textContent = `⭐ Safe ${me.safeRemaining||''}s`;
        } else { hp.textContent = ''; }
    }

    // ═══════════════════════════════════
    //  UI BUTTONS
    // ═══════════════════════════════════
    function initUI() {
        // Menu
        document.getElementById('btn-practice').addEventListener('click', startPractice);
        document.getElementById('btn-multiplayer').addEventListener('click', () => { initSocket(); showScreen('lobby-screen'); });
        document.getElementById('btn-how-to-play').addEventListener('click', () => showScreen('how-screen'));
        document.getElementById('btn-how-back').addEventListener('click', () => showScreen('menu-screen'));

        // Lobby
        document.getElementById('btn-create-room').addEventListener('click', () => {
            const name = document.getElementById('player-name').value.trim() || 'Player';
            socket.emit('createRoom', { name });
        });
        document.getElementById('btn-join-room').addEventListener('click', () => {
            const name = document.getElementById('player-name').value.trim() || 'Player';
            const code = document.getElementById('room-code-input').value.trim();
            if (!code) { document.getElementById('lobby-error').textContent = 'Enter a room code'; return; }
            socket.emit('joinRoom', { name, code });
        });
        document.getElementById('btn-lobby-back').addEventListener('click', () => showScreen('menu-screen'));

        // Waiting room
        document.getElementById('btn-copy-code').addEventListener('click', () => {
            navigator.clipboard.writeText(roomCode).then(() => {
                const btn = document.getElementById('btn-copy-code');
                btn.textContent = '✅ Copied!';
                setTimeout(() => { btn.textContent = '📋 Copy Room Code'; }, 1500);
            });
        });
        document.getElementById('btn-start-game').addEventListener('click', () => { socket.emit('startGame'); });
        document.getElementById('btn-leave-room').addEventListener('click', () => {
            socket.emit('leaveRoom');
            showScreen('menu-screen');
        });

        // Round over + Final
        document.getElementById('btn-next-round').addEventListener('click', () => {
            if (mode === 'practice') startLocalRound();
            else if (socket && isHost) socket.emit('nextRound');
        });
        document.getElementById('btn-play-again').addEventListener('click', () => {
            if (mode === 'practice') startPractice();
            else if (socket && isHost) socket.emit('playAgain');
        });
        document.getElementById('btn-main-menu').addEventListener('click', () => {
            gameRunning = false;
            if (socket) socket.emit('leaveRoom');
            showScreen('menu-screen');
        });
    }

    // ═══════════════════════════════════
    //  INIT
    // ═══════════════════════════════════
    function init() {
        initCanvas(); initInput(); initUI();
        showScreen('menu-screen');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
