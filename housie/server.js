const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game State
const rooms = {};

// Generator for Housie Ticket
function generateTicket() {
    const ticket = Array.from({ length: 3 }, () => Array(9).fill(0));
    const columns = Array.from({ length: 9 }, () => []);

    // Fill numbers 1-90 into columns
    // Col 0: 1-9; Col 1: 10-19 ... Col 8: 80-90
    for (let col = 0; col < 9; col++) {
        let min = col === 0 ? 1 : col * 10;
        let max = col === 8 ? 90 : (col * 10) + 9;
        let count = 0;
        // Each column must have at least 1 number, and max 3
        // To distribute 15 numbers across 9 columns: each col gets 1, then distribute remaining 6
        // randomly, ensuring no col exceeds 3.
        let numInCol = 1;
        columns[col].push(numInCol); // placeholder count for now
    }
    
    // Proper Tambola Ticket Generation logic is complex, simplifying for initial version:
    // Generate valid columns
    const ticketData = Array.from({ length: 3 }, () => Array(9).fill(0));
    let colCounts = [1,1,1,1,1,1,1,1,1];
    let remaining = 6;
    while(remaining > 0) {
        let r = Math.floor(Math.random() * 9);
        if (colCounts[r] < 3) {
            colCounts[r]++;
            remaining--;
        }
    }

    // Now insert numbers into columns
    const generatedNums = new Set();
    const getRandomNumForCol = (col) => {
        let min = col === 0 ? 1 : col * 10;
        let max = col === 8 ? 90 : (col * 10) + 9;
        let p;
        do {
            p = Math.floor(Math.random() * (max - min + 1)) + min;
        } while (generatedNums.has(p));
        generatedNums.add(p);
        return p;
    };

    for (let c = 0; c < 9; c++) {
        let count = colCounts[c];
        let nums = [];
        for (let i = 0; i < count; i++) {
            nums.push(getRandomNumForCol(c));
        }
        nums.sort((a,b)=>a-b);
        
        // Place in rows 0,1,2 randomly but in order
        let rowIndices = [];
        while(rowIndices.length < count) {
            let r = Math.floor(Math.random() * 3);
            if (!rowIndices.includes(r)) rowIndices.push(r);
        }
        rowIndices.sort();
        for(let i=0; i<count; i++) {
            ticketData[rowIndices[i]][c] = nums[i];
        }
    }

    // Ensure each row has exactly 5 numbers (adjusting rows if necessary)
    // The simplified logic above might not guarantee exactly 5 per row, 
    // real algorithm requires more constraints. For now this provides a playable grid.
    // Let's refine it to guarantee 5 per row strictly:
    const finalTicket = Array.from({ length: 3 }, () => Array(9).fill(0));
    // Blank all.
    // Select 5 distinct columns for each row
    const row0Cols = get5DistinctCols();
    const row1Cols = get5DistinctCols();
    const row2Cols = get5DistinctCols();
    
    // To ensure column rules (at least 1 per col), this might fail. 
    // Better simpler approach for now: return just valid random rows.
    
    return ticketData; 
}

function getValidTambolaTicket() {
    let ticket = Array.from({ length: 3 }, () => Array(9).fill(0));
    let numPerCol = Array(9).fill(0);
    // Fill each row with 5 unique numbers
    for (let row = 0; row < 3; row++) {
        let cols = [];
        while(cols.length < 5) {
            let c = Math.floor(Math.random() * 9);
            // Don't pick if col already has 3, or if we already picked this col for this row
            if (!cols.includes(c) && numPerCol[c] < 3) {
                cols.push(c);
                numPerCol[c]++;
            }
        }
        cols.sort();
        cols.forEach(c => {
            let min = c === 0 ? 1 : c * 10;
            let max = c === 8 ? 90 : (c * 10) + 9;
            ticket[row][c] = Math.floor(Math.random() * (max - min + 1)) + min;
        });
    }
    // We need to ensure numbers in each col are sorted downwards.
    for (let c = 0; c < 9; c++) {
        let colNums = [];
        for (let r = 0; r < 3; r++) {
            if (ticket[r][c] !== 0) colNums.push(ticket[r][c]);
        }
        // distinct
        colNums = [...new Set(colNums)];
        while(colNums.length < numPerCol[c]) {
             let min = c === 0 ? 1 : c * 10;
             let max = c === 8 ? 90 : (c * 10) + 9;
             let n = Math.floor(Math.random() * (max - min + 1)) + min;
             if(!colNums.includes(n)) colNums.push(n);
        }
        colNums.sort((a,b)=>a-b);
        let ptr = 0;
        for (let r = 0; r < 3; r++) {
            if (ticket[r][c] !== 0) {
                ticket[r][c] = colNums[ptr++];
            }
        }
    }
    return ticket;
}

// Socket Connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', (data, callback) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            host: socket.id,
            players: [],
            drawnNumbers: [],
            remainingNumbers: Array.from({length: 90}, (_, i) => i + 1),
            status: 'waiting',
            claims: []
        };
        joinUserToRoom(socket, roomId, data.name, true);
        callback({ roomId });
    });

    socket.on('joinRoom', (data, callback) => {
        const { roomId, name } = data;
        if (rooms[roomId]) {
            if (rooms[roomId].status === 'waiting') {
                joinUserToRoom(socket, roomId, name, false);
                callback({ success: true, roomId });
            } else {
                callback({ success: false, message: 'Game already started' });
            }
        } else {
            callback({ success: false, message: 'Room not found' });
        }
    });

    socket.on('startGame', (data) => {
        let roomId, mode;
        if (typeof data === 'string') {
            roomId = data;
            mode = 'manual';
        } else if (typeof data === 'object' && data !== null) {
            roomId = data.roomId;
            mode = data.mode;
        }

        if (roomId && rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].status = 'playing';
            rooms[roomId].mode = mode || 'manual';
            
            // Assign tickets
            rooms[roomId].players.forEach(p => {
                p.ticket = getValidTambolaTicket();
                io.to(p.id).emit('gameStarted', { ticket: p.ticket, players: rooms[roomId].players, mode: rooms[roomId].mode });
            });
            
            io.to(roomId).emit('roomStateUpdate', getRoomState(roomId));

            // Setup Auto Draw
            if (rooms[roomId].mode === 'auto') {
                rooms[roomId].autoDrawInterval = setInterval(() => {
                    const r = rooms[roomId];
                    if (r && r.status === 'playing' && r.remainingNumbers.length > 0) {
                        const index = Math.floor(Math.random() * r.remainingNumbers.length);
                        const number = r.remainingNumbers.splice(index, 1)[0];
                        r.drawnNumbers.push(number);
                        io.to(roomId).emit('numberDrawn', { number, drawnNumbers: r.drawnNumbers });
                        
                        if (r.remainingNumbers.length === 0) {
                            clearInterval(r.autoDrawInterval);
                        }
                    } else {
                        if (r) clearInterval(r.autoDrawInterval);
                    }
                }, 5000); // Draw every 5 seconds
            }
        }
    });

    socket.on('drawNumber', (roomId) => {
        if (rooms[roomId] && rooms[roomId].host === socket.id && rooms[roomId].status === 'playing') {
            if (rooms[roomId].remainingNumbers.length > 0) {
                const index = Math.floor(Math.random() * rooms[roomId].remainingNumbers.length);
                const number = rooms[roomId].remainingNumbers.splice(index, 1)[0];
                rooms[roomId].drawnNumbers.push(number);
                io.to(roomId).emit('numberDrawn', { number, drawnNumbers: rooms[roomId].drawnNumbers });
            }
        }
    });

    socket.on('claim', (data) => {
        const { roomId, claimType } = data;
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Verify claim based on player.ticket, room.drawnNumbers, and client's marked numbers
        const isValid = verifyClaim(claimType, player.ticket, room.drawnNumbers, data.markedNumbers || []);
        
        if (isValid) {
            // Check if already claimed
            const alreadyClaimed = room.claims.find(c => c.type === claimType);
            if (!alreadyClaimed) {
                room.claims.push({ type: claimType, player: player.name });
                io.to(roomId).emit('claimUpdate', { 
                    playerName: player.name, 
                    claimType, 
                    success: true 
                });

                if (room.claims.length === 5) {
                    room.status = 'finished';
                    if (room.autoDrawInterval) clearInterval(room.autoDrawInterval);
                    setTimeout(() => {
                        if (rooms[roomId]) {
                            io.to(roomId).emit('gameOver', { claims: room.claims });
                        }
                    }, 2000);
                }
            } else {
                socket.emit('claimError', 'Already claimed by someone else');
            }
        } else {
            socket.emit('claimError', 'Invalid claim');
        }
    });

    socket.on('disconnect', () => {
        // Handle player disconnect logic here (remove from rooms)
        for (let roomId in rooms) {
            const room = rooms[roomId];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                room.players.splice(pIndex, 1);
                io.to(roomId).emit('roomStateUpdate', getRoomState(roomId));
                if (room.players.length === 0) {
                    if (room.autoDrawInterval) clearInterval(room.autoDrawInterval);
                    delete rooms[roomId];
                } else if (room.host === socket.id) {
                    // reassign host
                    room.host = room.players[0].id;
                    room.players[0].isHost = true;
                    io.to(roomId).emit('roomStateUpdate', getRoomState(roomId));
                }
            }
        }
    });
});

function joinUserToRoom(socket, roomId, name, isHost) {
    socket.join(roomId);
    rooms[roomId].players.push({
        id: socket.id,
        name: name,
        isHost: isHost,
        ticket: null
    });
    io.to(roomId).emit('roomStateUpdate', getRoomState(roomId));
}

function getRoomState(roomId) {
    const room = rooms[roomId];
    return {
        id: room.id,
        players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })),
        status: room.status,
        drawnNumbers: room.drawnNumbers,
        claims: room.claims
    };
}

function verifyClaim(type, ticket, drawnNumbers, clientMarkedNumbers) {
    // simplified claim verification
    // drawnNumbers is an array of marked numbers generated by the server
    const drawnSet = new Set(drawnNumbers);
    const clientSet = new Set(clientMarkedNumbers);

    let linesCompleted = 0;
    let totalMarkedValid = 0;
    
    // Check rows
    for (let r = 0; r < 3; r++) {
        let rowCount = 0;
        let rowMarkedValid = 0;
        for (let c = 0; c < 9; c++) {
            if (ticket[r][c] !== 0) {
                rowCount++;
                if (drawnSet.has(ticket[r][c]) && clientSet.has(ticket[r][c])) {
                    rowMarkedValid++;
                }
            }
        }
        if (rowCount > 0 && rowCount === rowMarkedValid) {
            linesCompleted++;
        }
        totalMarkedValid += rowMarkedValid;
    }

    if (type === 'Jaldi 5') return totalMarkedValid >= 5;
    if (type === 'Row 1') {
        return checkRow(0, ticket, drawnSet, clientSet);
    }
    if (type === 'Row 2') {
        return checkRow(1, ticket, drawnSet, clientSet);
    }
    if (type === 'Row 3') {
        return checkRow(2, ticket, drawnSet, clientSet);
    }
    if (type === 'Full House') {
        const totalNums = ticket.flat().filter(n => n !== 0).length;
        return totalMarkedValid === totalNums && totalNums > 0;
    }

    return false;
}

function checkRow(rowIndex, ticket, drawnSet, clientSet) {
    let rowCount = 0;
    let rowMarkedValid = 0;
    for (let c = 0; c < 9; c++) {
        if (ticket[rowIndex][c] !== 0) {
            rowCount++;
            if (drawnSet.has(ticket[rowIndex][c]) && clientSet.has(ticket[rowIndex][c])) rowMarkedValid++;
        }
    }
    return rowCount > 0 && rowCount === rowMarkedValid;
}

const PORT = process.env.PORT || 3007;
server.listen(PORT, () => {
    console.log(`Housie server running on port ${PORT}`);
});
