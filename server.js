const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = 3000;

app.use(express.static('public'));

// Map of channelNumber => Set of client sockets
const channels = new Map();

wss.on('connection', (ws) => { // ws indicating a client object
  console.log('🔌 New client connected');

  // Track which channel this client is in
  let currentChannel = null;

  ws.on('message', (message) => { // If request received
    try {
        const data = JSON.parse(message); // Get data of request

        if (data.type === 'join') { // User trying to join a channel
            const channel = parseInt(data.channel); // Get channel ID attempt

            if (!isNaN(channel)) {
                // Leave previous channel
                if (currentChannel !== null) {
                    channels.get(currentChannel)?.delete(ws);
                }

                // Create new channel if non-existent
                if (!channels.has(channel)) { 
                    channels.set(channel, new Map());
                    channels.get(channel).set("clients", new Set())
                    channels.get(channel).set("state", "waiting")
                    console.log(`➕ Channel with ID ${channel} created by client`)
                } 
            
                // Join the channel
                if (channels.get(channel).get("clients").size < 2) { // Only join-able if less than two clients in channel
                    if (channels.get(channel).get("state") == 'waiting') { // Only join-able if in waiting state
                        channels.get(channel).get("clients").add(ws);
                        currentChannel = channel;
                        ws.send(JSON.stringify({ type: 'joined', id: channel })); // Send message
                        console.log(`👤 Client joined channel ${channel}`);

                        // Check if channel is full = game begin
                        if (channels.get(channel).get("clients").size == 2 & channels.get(channel).get("state") == "waiting") {
                            startGame(channel)
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', id: 2}))
                    }
                } else { // Kick user out
                    ws.send(JSON.stringify({ type: 'error', id: 1}))
                }
            }
        } else if (data.type === 'action') { // User trying to perform a game action
            // Check if the user is meant to act at this point
            if (!(channels.get(currentChannel).get("state") == "playing" & channels.get(currentChannel).get("activePlayer") == ws)) {
                return
            }

            // Go per-action
            if (data.contents == 'skip' & channels.get(currentChannel).get("innerState") == 'choosingAction') { // User trying to skip (REMOVE THIS LATER IF YOUVE MADE SURE TO RESET THE CANSKIP BOOL FOR OTHER ACTIONS HERE! ALSO IF YOU HAVE HANDLED INVALID REQUESTS > LET EM CHOOSE AGAIN!)
                if (channels.get(currentChannel).get("canSkip").get(ws)) {
                    // Turn is being skipped
                    channels.get(currentChannel).set("state", "actionDisplay")
                    channels.get(currentChannel).set("innerState", "actionDisplay")
                    channels.get(currentChannel).get("canSkip").set(ws, false)

                    // Display action result to both players
                    const clients = channels.get(currentChannel).get("clients")
                    for (let client of clients) {
                        if (client == ws) {
                            client.send(JSON.stringify({ type: 'game', contents: 'youAction', action: 'skip'}))
                        } else {
                            client.send(JSON.stringify({ type: 'game', contents: 'oppAction', action: 'skip'}))
                        }
                    }

                    // Timer for next turn
                    setTimeout(() => swapTurn(currentChannel), 5000)
                }
            } else if (data.contents == 'peek' & channels.get(currentChannel).get("innerState") == 'choosingAction') { // User trying to peek at an opp num
                // No checks to do
                channels.get(currentChannel).set("state", "actionDisplay")
                channels.get(currentChannel).set("innerState", "actionDisplay")
                channels.get(currentChannel).get("canSkip").set(ws, true) // Reset canskip bool for next turn

                // Get peeked number
                const clients = channels.get(currentChannel).get("clients")
                for (let client of clients) {
                    if (!(client == ws)) { // You are the opponent
                        peekNum = channels.get(currentChannel).get("numbers").get(client)[data.peekNum - 1]
                    }
                }

                // Send action data to clients
                for (let client of clients) {
                    if (client == ws) {
                        client.send(JSON.stringify({ type: 'game', contents: 'youAction', action: 'peek', peekNum: data.peekNum, value: peekNum}))
                    } else {
                        client.send(JSON.stringify({ type: 'game', contents: 'oppAction', action: 'peek', peekNum: data.peekNum}))
                    }
                }

                // Timer for next turn
                setTimeout(() => swapTurn(currentChannel), 5000)
            } else if (data.contents == 'playcard' & channels.get(currentChannel).get("innerState") == 'choosingAction') { // User is trying to play a card
                // Check if the card exists - check if not using input card on goal
                if (channels.get(currentChannel).get("cards").get(ws)[data.cardnum - 1] != null & !(channels.get(currentChannel).get("cards").get(ws)[data.cardnum - 1].input & data.applyto.type == 'goal')) {
                    // Check if valid id for player/opp (input)
                    if (data.applyto.type == 'player' & !(data.applyto.value == 1 || data.applyto.value == 2 || data.applyto.value == 3)) {
                        return
                    } else if (data.applyto.type == 'opp' & !(data.applyto.value == 1 || data.applyto.value == 2 || data.applyto.value == 3)) {
                        return
                    } else if (channels.get(currentChannel).get("cards").get(ws)[data.cardnum - 1].input & !(data.input == 1 || data.input == 2 || data.input == 3)) {
                        return
                    }

                    // Valid move! Play the card and update players
                    channels.get(currentChannel).get("canSkip").set(ws, true) // Reset canskip bool for next turn

                    if (channels.get(currentChannel).get("cards").get(ws)[data.cardnum - 1].input) {
                        playCard(currentChannel, data.cardnum, data.applyto, data.input)
                    } else {
                        playCard(currentChannel, data.cardnum, data.applyto)
                    }

                    // Timer for next turn
                    setTimeout(() => swapTurn(currentChannel), 5000)
                }
            } else if (data.contents == 'prepeek' & channels.get(currentChannel).get("innerState") == 'choosingAction') { // User is trying to use a prepeek
                // Check if the card exists - check if it has prepeek
                if (channels.get(currentChannel).get("cards").get(ws)[data.cardnum - 1] != null & channels.get(currentChannel).get("cards").get(ws)[data.cardnum - 1].prepeek) {
                    // Valid prepeek
                    channels.get(currentChannel).set("innerState", "postPrepeek")
                    channels.get(currentChannel).set("prepeekedCard", data.cardnum)

                    // Get peeked number
                    const clients = channels.get(currentChannel).get("clients")
                    for (let client of clients) {
                        if (!(client == ws)) { // You are the opponent
                            peekNum = channels.get(currentChannel).get("numbers").get(client)[data.peekNum - 1]
                        }
                    }

                    // Send action data to clients
                    channels.get(currentChannel).get("canSkip").set(ws, true) // Reset canskip bool for next turn
                    for (let client of clients) {
                        if (client == ws) {
                            client.send(JSON.stringify({ type: 'game', contents: 'youPrepeek', peekNum: data.peekNum, value: peekNum}))
                        } else {
                            client.send(JSON.stringify({ type: 'game', contents: 'oppPrepeek', peekNum: data.peekNum}))
                        }
                    }
                }
            } else if (data.contents == 'playcardprepeek' & channels.get(currentChannel).get("innerState") == 'postPrepeek') { // User is applying prepeek card
                prepeeknum = channels.get(currentChannel).get("prepeekedCard") // Get server-stored prepeek cardnum

                // Check if not using input card on goal
                if (!(channels.get(currentChannel).get("cards").get(ws)[prepeeknum - 1].input & data.applyto.type == 'goal')) {
                    // Check if valid id for player/opp (input)
                    if (data.applyto.type == 'player' & !(data.applyto.value == 1 || data.applyto.value == 2 || data.applyto.value == 3)) {
                        return
                    } else if (data.applyto.type == 'opp' & !(data.applyto.value == 1 || data.applyto.value == 2 || data.applyto.value == 3)) {
                        return
                    } else if (channels.get(currentChannel).get("cards").get(ws)[prepeeknum - 1].input & !(data.input == 1 || data.input == 2 || data.input == 3)) {
                        return
                    }

                    // Valid card usage after prepeek
                    channels.get(currentChannel).get("canSkip").set(ws, true) // Reset canskip bool for next turn
                    if (channels.get(currentChannel).get("cards").get(ws)[prepeeknum - 1].input) {
                        playCard(currentChannel, prepeeknum, data.applyto, data.input)
                    } else {
                        playCard(currentChannel, prepeeknum, data.applyto)
                    }

                    // Timer for next turn
                    setTimeout(() => swapTurn(currentChannel), 5000)
                }
            }
        }
    } catch (err) {
      console.error('⚠️ Bad message:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected');

    if (currentChannel !== null) {
      const room = channels.get(currentChannel);
      if (room) {
        room.get("clients").delete(ws);
        // If game is in progress, kick it
        if (!(channels.get(currentChannel).get("state") == "waiting" || channels.get(currentChannel).get("state") == "end")) {
            channels.delete(currentChannel);
            for (let client of room.get("clients")) {
                client.send(JSON.stringify({ type: 'error', id: 3}))
            }
            console.log(`❌ Channel with ID ${currentChannel} deleted`)
        }

        // Clean up if room is empty
        if (room.get("clients").size === 0) {
          channels.delete(currentChannel);
          console.log(`❌ Channel with ID ${currentChannel} deleted`)
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// Card rarity arrays //
cards_BASIC = [{"id": 1, "rarity":"basic","input":false},{"id": 2, "rarity":"basic","input":false},{"id": 3, "rarity":"basic","input":false},{"id": 4, "rarity":"basic","input":false},{"id": 5, "rarity":"basic","input":false},{"id": 6, "rarity":"basic","input":false},{"id": 7, "rarity":"basic","input":false},{"id": 8, "rarity":"basic","input":false},{"id": 9, "rarity":"basic","input":false},{"id": 10, "rarity":"basic","input":false}]
cards_COMMON = [{"id": 1, "rarity":"common","input":true},{"id": 2, "rarity":"common","input":true},{"id": 3, "rarity":"common","input":true},{"id": 4, "rarity":"common","input":true},{"id": 5, "rarity":"common","input":false},{"id": 6, "rarity":"common","input":false},{"id": 7, "rarity":"common","input":false},{"id": 8, "rarity":"common","input":false}]
cards_UNCOMMON = [{"id": 1, "rarity":"uncommon","input":true},{"id": 2, "rarity":"uncommon","input":false},{"id": 3, "rarity":"uncommon","input":true},{"id": 4, "rarity":"uncommon","input":true},{"id": 5, "rarity":"uncommon","input":true},{"id": 6, "rarity":"uncommon","input":false},{"id": 7, "rarity":"uncommon","input":false},{"id": 8, "rarity":"uncommon","input":false},{"id": 9, "rarity":"uncommon","input":false},{"id": 10, "rarity":"uncommon","input":false},{"id": 11, "rarity":"uncommon","input":false}]
cards_RARE = [{"id": 1, "rarity":"rare","input":false},{"id": 2, "rarity":"rare","input":false},{"id": 3, "rarity":"rare","input":false},{"id": 4, "rarity":"rare","input":false},{"id": 5, "rarity":"rare","input":false},{"id": 6, "rarity":"rare","input":true},{"id": 7, "rarity":"rare","input":true},{"id": 8, "rarity":"rare","input":false},{"id": 9, "rarity":"rare","input":true},{"id": 10, "rarity":"rare","input":true}]
cards_EPIC = [{"id": 1, "rarity":"epic","input":false},{"id": 2, "rarity":"epic","input":false},{"id": 3, "rarity":"epic","input":true},{"id": 4, "rarity":"epic","input":false},{"id": 5, "rarity":"epic","input":false}]
cards_LEGENDARY = [{"id": 1, "rarity":"legendary","input":false},{"id": 2, "rarity":"legendary","input":false},{"id": 3, "rarity":"legendary","input":false}]

// General functions //

function startGame(channel) {
    const channelData = channels.get(channel);
    if (!channelData) return;

    const clients = channelData.get("clients");
    if (!clients) return;

    for (let client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "start" }));
        }
    }

    // Optionally update channel state
    channelData.set("state", "countdown");
    console.log(`🕹️ Game started in channel ${channel}`);

    // Next steps
    initGame(channel)
    setTimeout(() => afterCountdown(channel), 5000)
}

function initGame(channel) {
    const channelData = channels.get(channel);
    if (!channelData) return;

    console.log(`🕹️ Game being initialized in channel ${channel}`)

    // Set card pile amount
    channels.get(channel).set("cardpile", 15)

    // Choose goal number
    if (Math.random() <= 0.5) {
        channels.get(channel).set("goal", Math.floor(Math.random() * 91) + 10) // 10 to 100
    } else {
        channels.get(channel).set("goal", Math.floor(Math.random() * 91) - 100) // -10 to -100
    }
    
    // Choose player cards
    channels.get(channel).set("cards", new Map())

    const clients = channelData.get("clients");
    if (!clients) return;

    for (let client of clients) {
        channels.get(channel).get("cards").set(client, handPull())
    }
    
    // Choose player numbers
    channels.get(channel).set("numbers", new Map())

    for (let client of clients) {
        channels.get(channel).get("numbers").set(client, [Math.floor(Math.random() * 21) - 10, Math.floor(Math.random() * 21) - 10, Math.floor(Math.random() * 21) - 10])
    }

    // Send information to right players
    for (let client of clients) {
        client.send(JSON.stringify({ type: 'init', cardpile: channels.get(channel).get("cardpile"), goal: channels.get(channel).get("goal"), cards: channels.get(channel).get("cards").get(client), numbers: channels.get(channel).get("numbers").get(client)}));
    }
}

function afterCountdown(channel) {
    if (channels.get(channel)) { // Fail-safe for if channel got booted during countdown
        const clients = channels.get(channel).get("clients")

        // Decide which player goes first
        firstGoer = Array.from(clients)[Math.floor(Math.random() * clients.size)]
        channels.get(channel).set("state", "playing")
        channels.get(channel).set("innerState", "choosingAction")
        channels.get(channel).set("activePlayer", firstGoer)
        channels.get(channel).set("canSkip", new Map())

        // Send this info to clients
        for (let client of clients) {
            channels.get(channel).get("canSkip").set(client, true) // Initiate canSkip var
            if (client == firstGoer) {
                client.send(JSON.stringify({ type: 'game', contents: 'yourTurn', canSkip: true}))
            } else {
                client.send(JSON.stringify({ type: 'game', contents: 'oppTurn'}))
            }
        }

        // Now we wait for right player to send decision
    }
}

function cardPull() {
    // Pulls a random card from the card pool
    rarityVal = Math.random()
    prepeekVal = Math.random()
    if (rarityVal <= 0.38) {
        // BASIC CARD
        randomCard = cards_BASIC[Math.floor(Math.random() * cards_BASIC.length)]
        if (prepeekVal <= 0.5) {
            randomCard.prepeek = true
        } else {
            randomCard.prepeek = false
        }
        return randomCard
    } else if (rarityVal <= 0.65) {
        // COMMON CARD
        randomCard = cards_COMMON[Math.floor(Math.random() * cards_COMMON.length)]
        if (prepeekVal <= 0.35) {
            randomCard.prepeek = true
        } else {
            randomCard.prepeek = false
        }
        return randomCard
    } else if (rarityVal <= 0.83) {
        // UNCOMMON CARD
        randomCard = cards_UNCOMMON[Math.floor(Math.random() * cards_UNCOMMON.length)]
        if (prepeekVal <= 0.2) {
            randomCard.prepeek = true
        } else {
            randomCard.prepeek = false
        }
        return randomCard
    } else if (rarityVal <= 0.94) {
        // RARE CARD
        randomCard = cards_RARE[Math.floor(Math.random() * cards_RARE.length)]
        if (prepeekVal <= 0.1) {
            randomCard.prepeek = true
        } else {
            randomCard.prepeek = false
        }
        return randomCard
    } else if (rarityVal <= 0.99) {
        // EPIC CARD
        randomCard = cards_EPIC[Math.floor(Math.random() * cards_EPIC.length)]
        if (prepeekVal <= 0.05) {
            randomCard.prepeek = true
        } else {
            randomCard.prepeek = false
        }
        return randomCard
    } else {
        // LEGENDARY CARD
        randomCard = cards_LEGENDARY[Math.floor(Math.random() * cards_LEGENDARY.length)]
        if (prepeekVal <= 0.01) {
            randomCard.prepeek = true
        } else {
            randomCard.prepeek = false
        }
        return randomCard
    }
}

function handPull() {
    // Returns an array of five cards representing a player hand
    let output = []

    for(let i = 0; i < 5; i++){
        output.push(cardPull())
    }

    return output
}

function swapTurn(channel) {
    if (channels.get(channel)) { // Fail-safe for if channel got booted or ended during timeout
        // End of game check
        if (channels.get(channel).get("cardpile") <= 0) { // If card pile is empty
            const clients = channels.get(channel).get("clients")
            for (let client of clients) {
                if (channels.get(channel).get("cards").get(client).every(card => card === null)) { // If a player has no cards left
                    endGame(channel)
                    break
                }
            }
        }

        if (channels.get(channel).get("state") == "end") {
            return
        }

        // Swaps the turn to the other player
        const clients = channels.get(channel).get("clients")
        const oldActive = channels.get(channel).get("activePlayer")

        channels.get(channel).set("state", "playing")
        channels.get(channel).set("innerState", "choosingAction")

        for (let client of clients) {
            if (client == oldActive) {
                client.send(JSON.stringify({ type: 'game', contents: 'oppTurn'}))
            } else {
                channels.get(channel).set("activePlayer", client)
                client.send(JSON.stringify({ type: 'game', contents: 'yourTurn', canSkip: channels.get(channel).get("canSkip").get(client)}))
            }
        }
    }
}

function playCard(channel,cardNum,applyTo,input) {
    // Find player and opp
    let player = channels.get(channel).get("activePlayer")
    let opp;
    let mainValue;
    let inputValue;
    let outputValue;
    let goalValue;

    const clients = channels.get(channel).get("clients")
    for (let client of clients) {
        if (!(client == player)) {
            opp = client
        }
    }

    // Get the main value
    if (applyTo.type == 'player') {
        mainValue = channels.get(channel).get("numbers").get(player)[applyTo.value - 1]
    } else if (applyTo.type == 'opp') {
        mainValue = channels.get(channel).get("numbers").get(opp)[applyTo.value - 1]
    } else if (applyTo.type == 'goal') {
        mainValue = channels.get(channel).get("goal")
    }

    // Get input if necessary
    if (channels.get(channel).get("cards").get(player)[cardNum - 1].input) {
        inputValue = channels.get(channel).get("numbers").get(player)[input - 1]
    }

    // Get goal for legendary cards
    goalValue = channels.get(channel).get("goal")

    // Perform maths operations
    if (channels.get(channel).get("cards").get(player)[cardNum - 1].rarity == "basic") { // BASIC CARDS
        if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 1) { // PLUS ONE
            outputValue = mainValue + 1
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 2) { // MINUS ONE
            outputValue = mainValue - 1
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 3) { // DOUBLE
            outputValue = 2 * mainValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 4) { // HALVE
            outputValue = Math.round(mainValue / 2)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 5) { // x5
            outputValue = mainValue * 5
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 6) { // x10
            outputValue = mainValue * 10
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 7) { // x100
            outputValue = mainValue * 100
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 8) { // /5
            outputValue = Math.round(mainValue / 5)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 9) { // /10
            outputValue = Math.round(mainValue / 10)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 10) { // /100
            outputValue = Math.round(mainValue / 100)
        }
    } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].rarity == "common") { // COMMON CARDS
        if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 1) { // PLUS
            outputValue = mainValue + inputValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 2) { // MINUS
            outputValue = mainValue - inputValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 3) { // TIMES
            outputValue = mainValue * inputValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 4) { // DIVIDE
            if (inputValue == 0) {outputValue = Math.sign(mainValue) * 1_000_000}
            else {outputValue = Math.round(mainValue / inputValue)}
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 5) { // NEGATE
            outputValue = -1 * mainValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 6) { // SQUARE
            outputValue = mainValue**2
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 7) { // CUBE
            outputValue = mainValue**3
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 8) { // SQUARE ROOT
            outputValue = Math.sign(mainValue) * Math.round(Math.sqrt(Math.abs(mainValue)))
        }
    } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].rarity == "uncommon") { // UNCOMMON CARDS
        if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 1) { // POWER
            outputValue = mainValue**inputValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 2) { // ABSOLUTE VALUE
            outputValue = Math.abs(mainValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 3) { // ROOT
            outputValue = Math.sign(mainValue) * Math.round(Math.abs(mainValue)**(1/inputValue))
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 4) { // APPEND
            outputValue = Math.sign(mainValue*inputValue) * parseInt('' + Math.abs(mainValue) + Math.abs(inputValue), 10)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 5) { // PREPEND
            outputValue = Math.sign(mainValue*inputValue) * parseInt('' + Math.abs(inputValue) + Math.abs(mainValue), 10)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 6) { // DIGIT SUM
            outputValue = Math.sign(mainValue) * [...String(Math.abs(mainValue))].reduce((a, b) => a + +b, 0)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 7) { // DIGIT PRODUCT
            outputValue = Math.sign(mainValue) * [...String(Math.abs(mainValue))].reduce((a, b) => a * +b, 1);
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 8) { // RANDOMIZE
            if (applyTo.type == 'goal') {
                if (Math.random() <= 0.5) {
                    channels.get(channel).set("goal", Math.floor(Math.random() * 91) + 10) // 10 to 100
                } else {
                    channels.get(channel).set("goal", Math.floor(Math.random() * 91) - 100) // -10 to -100
                }
            } else {
                outputValue = Math.floor(Math.random() * 21) - 10
            }
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 9) { // DIGIT COUNT
            outputValue = String(Math.abs(mainValue)).length;
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 10) { // SORT ASCENDING
            outputValue = Math.sign(mainValue) * parseInt([...String(Math.abs(mainValue))].sort().join(''), 10);
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 11) { // SORT DESCENDING
            outputValue = Math.sign(mainValue) * parseInt([...String(Math.abs(mainValue))].sort().reverse().join(''), 10);
        }
    } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].rarity == "rare") { // RARE CARDS
        if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 1) { // DIGITS REVERSE
            outputValue = Math.sign(mainValue) * parseInt(String(Math.abs(mainValue)).split('').reverse().join(''), 10);
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 2) { // DROP LAST DIGIT
            if (mainValue > -10 & mainValue < 10) {
                outputValue = 0;
            } else {
                outputValue = Math.sign(mainValue) * Math.trunc(Math.abs(mainValue) / 10);
            }
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 3) { // DROP FIRST DIGIT
            if (mainValue > -10 & mainValue < 10) {
                outputValue = 0;
            } else {
                outputValue = Math.sign(mainValue) * parseInt(String(Math.abs(mainValue)).slice(1), 10);
            }
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 4) { // PRIME JUMP
            outputValue = nearestPrime(mainValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 5) { // PERFECT SQUARE
            outputValue = nearestPerfectSquare(mainValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 6) { // MODULO
            const mod = (a, n) => ((a % n) + n) % n;
            outputValue = mod(mainValue, inputValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 7) { // NEAREST MULTIPLE
            outputValue = nearestMultiple(mainValue, inputValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 8) { // PALINDROME
            outputValue = Math.sign(mainValue) * parseInt(String(Math.abs(mainValue)) + String(Math.abs(mainValue)).slice(0, -1).split('').reverse().join(''), 10)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 9) { // GCD
            const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);
            outputValue = gcd(mainValue, inputValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 10) { // LCM
            const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);
            const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
            outputValue = lcm(mainValue, inputValue)
        }
    } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].rarity == "epic") { // EPIC CARDS
        if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 1) { // FACTORIAL
            outputValue = factorial(mainValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 2) { // NEAREST FIBONACCI
            outputValue = closestFibonacci(mainValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 3) { // COPY NUMBER
            outputValue = inputValue
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 4) { // DOUBLE FACTORIAL
            outputValue = doubleFactorial(mainValue)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 5) { // DIVISOR SUM
            outputValue = sumDivisors(mainValue)
        }
    } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].rarity == "legendary") { // LEGENDARY CARDS
        if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 1) { // HALVE DISTANCE
            outputValue = Math.round((mainValue + goalValue) / 2)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 2) { // PERCENTAGE
            outputValue = Math.round(mainValue / goalValue * 100)
        } else if (channels.get(channel).get("cards").get(player)[cardNum - 1].id == 3) { // ORBIT
            outputValue = mainValue + 2 * (goalValue - mainValue)
        }
    }

    // Lock output to range
    if (outputValue > 1000000) {outputValue = 1000000}
    if (outputValue < -1000000) {outputValue = -1000000}

    // Set output to right value
    if (applyTo.type == 'player') {
        channels.get(channel).get("numbers").get(player)[applyTo.value - 1] = outputValue
    } else if (applyTo.type == 'opp') {
        channels.get(channel).get("numbers").get(opp)[applyTo.value - 1] = outputValue
    } else if (applyTo.type == 'goal') {
        channels.get(channel).set("goal", outputValue)
    }

    // Send both players action confirmation
    for (let client of clients) {
        if (client == player) {
            client.send(JSON.stringify({ type: 'game', contents: 'youAction', action: 'playedCard', card: channels.get(channel).get("cards").get(player)[cardNum - 1], applyto: applyTo.type}));
        } else {
            client.send(JSON.stringify({ type: 'game', contents: 'oppAction', action: 'playedCard', card: channels.get(channel).get("cards").get(player)[cardNum - 1], applyto: applyTo.type}));
        }
        
    }

    // Remove card from player
    channels.get(channel).get("cards").get(player)[cardNum - 1] = null

    // Give player new random card (if possible) and subtract cardpile
    if (channels.get(channel).get("cardpile") > 0) {
        channels.get(channel).get("cards").get(player)[cardNum - 1] = cardPull()
        channels.get(channel).set("cardpile", channels.get(channel).get("cardpile") - 1)
    }

    // Check if a player has exactly the goal (notified to both)
    goalValue = channels.get(channel).get("goal")
    let golds = new Map()
    for (let client of clients) {
        golds.set(client, new Array())
        for (let num of channels.get(channel).get("numbers").get(client)) {
            if (num == goalValue) {
                golds.get(client).push(true)
            } else {
                golds.get(client).push(false)
            }
        }
    }

    // Check if a player has empty cards (notified to opp for display)
    let empties = new Map()
    for (let client of clients) {
        empties.set(client, new Array())
        for (let card of channels.get(channel).get("cards").get(client)) {
            if (card == null) {
                empties.get(client).push(true)
            } else {
                empties.get(client).push(false)
            }
        }
    }

    // Send both players update about their current situation
    for (let client of clients) {
        let otherGolds = null
        let otherEmpties = null
        for (const [clientName, value] of golds.entries()) {
            if (clientName !== client) {
                otherGolds = value
            }
        }
        for (const [clientName, value] of empties.entries()) {
            if (clientName !== client) {
                otherEmpties = value
            }
        }
        client.send(JSON.stringify({ type: 'update', cardpile: channels.get(channel).get("cardpile"), goal: channels.get(channel).get("goal"), cards: channels.get(channel).get("cards").get(client), numbers: channels.get(channel).get("numbers").get(client), golds: otherGolds, empties: otherEmpties}));
    }

    // Set innerstate and state
    channels.get(channel).set("state", "actionDisplay")
    channels.get(channel).set("innerState", "actionDisplay")
}

function endGame(channel) {
    channels.get(channel).set("state", "end")
    channels.get(channel).set("innerState", "end")

    // Find the winner or a tie
    winner = null;
    winningNumber = 0;
    closestDistance = 9_999_999;
    goalNumber = channels.get(channel).get("goal")
    tie = false;

    const clients = channels.get(channel).get("clients")
    for (let client of clients) {
        for (let num of channels.get(channel).get("numbers").get(client)) {
            if (Math.abs(goalNumber - num) < closestDistance) {
                winner = client
                winningNumber = num
                tie = false
                closestDistance = Math.abs(goalNumber - num)
            } else if (Math.abs(goalNumber - num) == closestDistance & winner != client) {
                tie = true
            }
        }
    }

    if (tie) {
        // Try tie-breaking by finding largest absolute sum
        largest = 0;
        winner = null;
        tie = false;
        for (let client of clients) {
            if (sum(channels.get(channel).get("numbers").get(client)) > largest) {
                winner = client
                largest = sum(channels.get(channel).get("numbers").get(client))
                tie = false
            } else if (sum(channels.get(channel).get("numbers").get(client)) == largest & winner != client) {
                tie = true
            }
        }

        // Now try determining winner
        if (tie) {
            for (let client of clients) {
                if (client == winner) { // WIP FOR LATER: MAYBE DISPLAY OPP CARDS AND NUMBERS WHEN ITS OVER HERE? OR MORE STATS
                    client.send(JSON.stringify({ type: 'end', contents: 'tie'}));
                } else {
                    client.send(JSON.stringify({ type: 'end', contents: 'tie'}));
                }
            }
        } else {
            for (let client of clients) {
                if (client == winner) { // WIP FOR LATER: MAYBE DISPLAY OPP CARDS AND NUMBERS WHEN ITS OVER HERE? OR MORE STATS
                    client.send(JSON.stringify({ type: 'end', contents: 'win', breaker: true}));
                } else {
                    client.send(JSON.stringify({ type: 'end', contents: 'lose', breaker: true}));
                }
            }
        }
    } else {
        // No tie, send data
        for (let client of clients) {
            if (client == winner) { // WIP FOR LATER: MAYBE DISPLAY OPP CARDS AND NUMBERS WHEN ITS OVER HERE? OR MORE STATS
                client.send(JSON.stringify({ type: 'end', contents: 'win', breaker: false, winNum: winningNumber, goal: channels.get(channel).get("goal")}));
            } else {
                client.send(JSON.stringify({ type: 'end', contents: 'lose', breaker: false, winNum: winningNumber, goal: channels.get(channel).get("goal")}));
            }
        }
    }
    console.log(`🏁 Game has ended in channel ${channel}`)
}

// Maths functions (mostly credits to ChatGPT and Claude) //

function nearestPrime(n) {
    if (n < 0) {
        return 2
    }

  function isPrime(x) {
    if (x < 2) return false;
    const limit = Math.floor(Math.sqrt(x));
    for (let i = 2; i <= limit; i++) {
      if (x % i === 0) return false;
    }
    return true;
  }

  if (n <= 2) return 2;

  for (let offset = 0; ; offset++) {
    if (isPrime(n - offset)) return n - offset;
    if (isPrime(n + offset)) return n + offset;
  }
}

function nearestPerfectSquare(n) {
  if (n < 0) return 0; // perfect squares are non-negative
  
  const root = Math.floor(Math.sqrt(n));
  const lower = root * root;
  const upper = (root + 1) * (root + 1);
  
  // Check which square is closer to n
  return (n - lower <= upper - n) ? lower : upper;
}

function nearestMultiple(num, multiple) {
  if (multiple === 0) return 0; // avoid division by zero
  const quotient = Math.round(num / multiple);
  return quotient * multiple;
}

function closestFibonacci(n) {
  if (n <= 0) return 0;
  let a = 0, b = 1;
  while (b < n) {
    [a, b] = [b, a + b];
  }
  // b is now the first fib >= n, a is the previous fib
  return (b - n) < (n - a) ? b : a;
}

const factorial = n => n < 0 ? -1_000_000 : n <= 1 ? 1 : n * factorial(n - 1);

const doubleFactorial = n => n < 0 ? -1_000_000 : n <= 1 ? 1 : n * doubleFactorial(n - 2);

function sumDivisors(n) {
  n = Math.abs(n);
  let sum = 0;
  const limit = Math.floor(Math.sqrt(n));
  for (let i = 1; i <= limit; i++) {
    if (n % i === 0) {
      sum += i;
      if (i !== n / i) sum += n / i;
    }
  }
  return sum;
}

// NOTE: if a request is sent by like clicking shit (or anything actually) it might take a bit so prevent them from spamming requests in that window by perhaps setting the state to "waiting" like you already do for prepeek