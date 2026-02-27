const socket = io();

// State
let currentRoomId = null;
let playerName = '';
let isHost = false;
let myTicket = null;
let drawnNumbersState = new Set();

// DOM Elements
const screenLobby = document.getElementById('screen-lobby');
const screenWaiting = document.getElementById('screen-waiting');
const screenGame = document.getElementById('screen-game');
const screenGameOver = document.getElementById('screen-game-over');

// Lobby Elements
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const inputPlayerName = document.getElementById('player-name');
const inputRoomId = document.getElementById('room-id-input');
const lobbyError = document.getElementById('lobby-error');

// Waiting Elements
const displayRoomCode = document.getElementById('display-room-code');
const playersUl = document.getElementById('players-ul');
const playerCount = document.getElementById('player-count');
const hostControls = document.getElementById('host-controls');
const waitingMsg = document.getElementById('waiting-msg');
const btnStartGame = document.getElementById('btn-start-game');
const btnCopyCode = document.getElementById('btn-copy-code');
const dropdownSelected = document.getElementById('dropdown-selected');
const dropdownOptions = document.getElementById('dropdown-options');
let selectedDrawMode = 'manual';

// Game Elements
const mainBoard = document.getElementById('main-board');
const latestDrawNumber = document.getElementById('latest-draw-number');
const gameHostControls = document.getElementById('game-host-controls');
const btnDrawNumber = document.getElementById('btn-draw-number');
const playerTicket = document.getElementById('player-ticket');
const btnClaims = document.querySelectorAll('.btn-claim');
const activityLog = document.getElementById('activity-log');

// Game Over Elements
const scoreboardList = document.getElementById('scoreboard-list');
const btnBackToLobby = document.getElementById('btn-back-to-lobby');

// Initialization
function init() {
    generateMainBoard();
    
    // Custom Dropdown Logic
    if (dropdownSelected) {
        dropdownSelected.addEventListener('click', () => {
            dropdownSelected.classList.toggle('open');
            dropdownOptions.parentElement.classList.toggle('open');
        });

        document.querySelectorAll('.dropdown-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const value = e.target.getAttribute('data-value');
                const text = e.target.textContent;
                
                selectedDrawMode = value;
                dropdownSelected.textContent = text;
                dropdownSelected.setAttribute('data-value', value);
                
                document.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
                e.target.classList.add('selected');

                dropdownSelected.classList.remove('open');
                dropdownOptions.parentElement.classList.remove('open');
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdownSelected.contains(e.target) && !dropdownOptions.contains(e.target)) {
                dropdownSelected.classList.remove('open');
                dropdownOptions.parentElement.classList.remove('open');
            }
        });
    }

    btnCreateRoom.addEventListener('click', () => {
        playerName = inputPlayerName.value.trim();
        if (!playerName) {
            lobbyError.textContent = "Please enter your name.";
            return;
        }
        socket.emit('createRoom', { name: playerName }, (response) => {
            currentRoomId = response.roomId;
            isHost = true;
            showScreen(screenWaiting);
            displayRoomCode.textContent = currentRoomId;
            updateHostUI();
        });
    });

    btnJoinRoom.addEventListener('click', () => {
        playerName = inputPlayerName.value.trim();
        const roomId = inputRoomId.value.trim().toUpperCase();
        if (!playerName || !roomId) {
            lobbyError.textContent = "Please enter name and room code.";
            return;
        }
        socket.emit('joinRoom', { roomId, name: playerName }, (response) => {
            if (response.success) {
                currentRoomId = response.roomId;
                isHost = false;
                showScreen(screenWaiting);
                displayRoomCode.textContent = currentRoomId;
                updateHostUI();
            } else {
                lobbyError.textContent = response.message;
            }
        });
    });

    btnStartGame.addEventListener('click', () => {
        socket.emit('startGame', { roomId: currentRoomId, mode: selectedDrawMode });
    });

    btnDrawNumber.addEventListener('click', () => {
        socket.emit('drawNumber', currentRoomId);
    });

    btnClaims.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.classList.contains('claimed')) return;
            const claimType = e.target.getAttribute('data-claim');
            
            // Collect marked numbers from the DOM
            const markedElements = document.querySelectorAll('.ticket-cell.marked');
            const markedNumbers = Array.from(markedElements).map(el => parseInt(el.textContent, 10));

            socket.emit('claim', { roomId: currentRoomId, claimType, markedNumbers });
        });
    });

    btnCopyCode.addEventListener('click', () => {
        const code = displayRoomCode.textContent;
        if (code && code !== '---') {
            navigator.clipboard.writeText(code).then(() => {
                showToast('Room code copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Failed to copy: ', err);
                showToast('Failed to copy code.', 'error');
            });
        }
    });

    btnBackToLobby.addEventListener('click', () => {
        window.location.reload();
    });
}

function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function updateHostUI() {
    if (isHost) {
        hostControls.style.display = 'block';
        waitingMsg.style.display = 'none';
        gameHostControls.style.display = 'block';
    } else {
        hostControls.style.display = 'none';
        waitingMsg.style.display = 'block';
        gameHostControls.style.display = 'none';
    }
}

function generateMainBoard() {
    mainBoard.innerHTML = '';
    for (let i = 1; i <= 90; i++) {
        const div = document.createElement('div');
        div.className = 'board-num';
        div.id = `board-num-${i}`;
        div.textContent = i;
        mainBoard.appendChild(div);
    }
}

function renderTicket(ticketData) {
    playerTicket.innerHTML = '';
    myTicket = ticketData;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
            const num = ticketData[r][c];
            const div = document.createElement('div');
            div.className = 'ticket-cell';
            if (num !== 0) {
                div.classList.add('has-num');
                div.textContent = num;
                // Add click to mark
                div.addEventListener('click', () => {
                    if (drawnNumbersState.has(num)) {
                        div.classList.toggle('marked');
                    } else {
                        showToast(`Wait! ${num} has not been drawn yet.`, 'error');
                    }
                });
            } else {
                div.classList.add('empty');
            }
            playerTicket.appendChild(div);
        }
    }
}

function logActivity(msg) {
    const li = document.createElement('li');
    li.innerHTML = msg;
    activityLog.prepend(li);
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Socket Events
socket.on('roomStateUpdate', (state) => {
    // Update waiting room
    playersUl.innerHTML = '';
    playerCount.textContent = state.players.length;
    
    // Check if I became host
    const me = state.players.find(p => p.id === socket.id);
    if (me && me.isHost !== isHost) {
        isHost = me.isHost;
        updateHostUI();
        showToast("You are now the host!", 'info');
    }

    state.players.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `${p.name} ${p.isHost ? '<span class="badge">Host</span>' : ''}`;
        playersUl.appendChild(li);
    });

    if (state.status === 'playing' && screenWaiting.classList.contains('active')) {
        showScreen(screenGame);
    }
});

socket.on('gameStarted', (data) => {
    showScreen(screenGame);
    renderTicket(data.ticket);
    logActivity('<strong>Game Started!</strong> Good luck.');
    showToast('Game Started!', 'success');

    if (data.mode === 'auto') {
        btnDrawNumber.style.display = 'none';
        logActivity('<i>Auto Draw mode is actively drawing numbers every 5 seconds...</i>');
    } else {
        btnDrawNumber.style.display = 'inline-block';
    }
});

socket.on('numberDrawn', (data) => {
    const { number, drawnNumbers } = data;
    latestDrawNumber.textContent = number;
    
    // Update local set of drawn numbers
    drawnNumbersState.add(number);

    // Update Main Board
    const boardNum = document.getElementById(`board-num-${number}`);
    if (boardNum) boardNum.classList.add('drawn');

    logActivity(`Number drawn: <strong>${number}</strong>`);
});

socket.on('claimUpdate', (data) => {
    const { playerName, claimType, success } = data;
    if (success) {
        logActivity(`🎉 <strong>${playerName}</strong> successfully claimed <strong>${claimType}</strong>!`);
        // Disable the button for everyone
        const btn = document.querySelector(`.btn-claim[data-claim="${claimType}"]`);
        if (btn) {
            btn.classList.add('claimed');
            btn.textContent += ' (Claimed)';
        }
        showToast(`${playerName} claimed ${claimType}`, 'success');
    }
});

socket.on('claimError', (msg) => {
    showToast(msg, 'error');
});

socket.on('gameOver', (data) => {
    const { claims } = data;
    showScreen(screenGameOver);
    
    scoreboardList.innerHTML = '';
    claims.forEach(c => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="claim-type">${c.type}</span> <span class="claim-player">${c.player}</span>`;
        scoreboardList.appendChild(li);
    });

    showToast('Game Over!', 'info');
});

init();
