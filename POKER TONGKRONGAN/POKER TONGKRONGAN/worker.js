const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const SUITS = ["D", "C", "H", "S"];
const SUIT_VALUES = { D: 0, C: 1, H: 2, S: 3 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/ws") {
      const id = env.GAME.idFromName("global");
      return env.GAME.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class GameHub {
  constructor(ctx) {
    this.ctx = ctx;
    this.rooms = {};
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await ctx.storage.get("rooms")) || {};
    });
  }

  async fetch(request) {
    await this.ready;
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null });
    this.send(server, "connected", {});
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    await this.ready;
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.send(socket, "errorMessage", "Pesan tidak valid.");
      return;
    }

    const { event, payload = {} } = message;
    try {
      switch (event) {
        case "listLobby":
          this.send(socket, "lobby", this.publicRooms());
          break;
        case "createRoom":
          await this.leave(socket);
          await this.createRoom(socket, payload);
          break;
        case "joinPublic":
          await this.leave(socket);
          await this.joinPublic(socket, payload);
          break;
        case "joinRoom":
          await this.leave(socket);
          await this.joinRoom(socket, payload);
          break;
        case "addBots":
          await this.updateBots(socket, true);
          break;
        case "removeBots":
          await this.updateBots(socket, false);
          break;
        case "startGame":
          await this.startGame(socket);
          break;
        case "playCards":
          await this.playCards(socket, payload.cards);
          break;
        case "passTurn":
          await this.passTurn(socket);
          break;
        case "leaveRoom":
          await this.leave(socket);
          break;
        default:
          this.send(socket, "errorMessage", "Aksi tidak dikenal.");
      }
    } catch (error) {
      console.error("Game event failed:", error);
      this.send(socket, "errorMessage", "Terjadi masalah di server. Coba lagi.");
    }
  }

  async webSocketClose(socket) {
    await this.ready;
    await this.leave(socket, true);
  }

  async webSocketError(socket) {
    await this.ready;
    await this.leave(socket, true);
  }

  send(socket, event, payload) {
    try {
      socket.send(JSON.stringify({ event, payload }));
    } catch (error) {
      console.error("WebSocket send failed:", error);
    }
  }

  broadcast(event, payload) {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, event, payload);
  }

  publicRooms() {
    return Object.values(this.rooms)
      .filter((room) => !room.privateRoom && !room.game)
      .map((room) => ({
        code: room.code,
        players: room.players.filter((player) => !player.bot).length,
        seats: room.players.length,
        status: "waiting",
      }));
  }

  async save() {
    await this.ctx.storage.put("rooms", this.rooms);
  }

  roomForPlayer(playerId) {
    if (!playerId) return null;
    return Object.values(this.rooms).find((room) => room.players.some((player) => player.id === playerId)) || null;
  }

  socketForPlayer(playerId) {
    return this.ctx.getWebSockets().find((socket) => socket.deserializeAttachment()?.playerId === playerId);
  }

  roomView(room, viewerId) {
    return {
      code: room.code,
      privateRoom: room.privateRoom,
      hostId: room.hostId,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        bot: player.bot,
        connected: player.connected,
        hand: room.game && player.id === viewerId ? player.hand : [],
        cardCount: room.game ? player.hand.length : 0,
      })),
      game: room.game && {
        turnId: room.game.turnId,
        openingCards: room.game.openingCards,
        twoLowInStraight: room.game.twoLowInStraight,
        trick: room.game.trick,
        passed: room.game.passed,
        finished: room.game.finished,
        winnerId: room.game.winnerId,
        loserId: room.game.loserId,
      },
    };
  }

  async sendRoom(room) {
    await this.save();
    for (const player of room.players) {
      if (player.bot || !player.connected) continue;
      const socket = this.socketForPlayer(player.id);
      if (socket) this.send(socket, "roomState", this.roomView(room, player.id));
    }
    this.broadcast("lobby", this.publicRooms());
  }

  fail(socket, message) {
    this.send(socket, "errorMessage", message);
  }

  attachPlayer(socket, room, name) {
    const player = {
      id: crypto.randomUUID(),
      name: String(name || "Pemain").trim().slice(0, 18) || "Pemain",
      bot: false,
      connected: true,
      hand: [],
    };
    room.players.push(player);
    if (!room.hostId) room.hostId = player.id;
    socket.serializeAttachment({ playerId: player.id });
    this.send(socket, "session", { id: player.id });
    return this.sendRoom(room);
  }

  newRoom(privateRoom) {
    let code;
    do {
      code = crypto.randomUUID().slice(0, 6).toUpperCase();
    } while (this.rooms[code]);
    const room = { code, privateRoom, hostId: null, players: [], game: null };
    this.rooms[code] = room;
    return room;
  }

  async createRoom(socket, payload) {
    const room = this.newRoom(Boolean(payload.privateRoom));
    await this.attachPlayer(socket, room, payload.name);
  }

  async joinPublic(socket, payload) {
    let room = Object.values(this.rooms).find((candidate) =>
      !candidate.privateRoom && !candidate.game && candidate.players.length < 4
    );
    if (!room) room = this.newRoom(false);
    await this.attachPlayer(socket, room, payload.name);
  }

  async joinRoom(socket, payload) {
    const code = String(payload.code || "").trim().toUpperCase();
    const room = this.rooms[code];
    if (!room) return this.fail(socket, "Room tidak ditemukan. Cek lagi kodenya.");
    if (room.game || room.players.length >= 4) return this.fail(socket, "Room sudah penuh atau permainan sudah dimulai.");
    await this.attachPlayer(socket, room, payload.name);
  }

  async updateBots(socket, add) {
    const room = this.roomForPlayer(socket.deserializeAttachment()?.playerId);
    if (!room || room.hostId !== socket.deserializeAttachment()?.playerId || room.game) {
      return this.fail(socket, "Hanya host yang bisa mengatur bot sebelum game.");
    }
    if (add) {
      let botNumber = 1;
      while (room.players.length < 4) {
        while (room.players.some((player) => player.name === `Bot ${botNumber}`)) botNumber += 1;
        room.players.push({
          id: `bot-${crypto.randomUUID()}`,
          name: `Bot ${botNumber}`,
          bot: true,
          connected: true,
          hand: [],
        });
        botNumber += 1;
      }
    } else {
      room.players = room.players.filter((player) => !player.bot);
    }
    await this.sendRoom(room);
  }

  async startGame(socket) {
    const playerId = socket.deserializeAttachment()?.playerId;
    const room = this.roomForPlayer(playerId);
    if (!room || room.hostId !== playerId || room.game) return this.fail(socket, "Hanya host yang bisa memulai game.");
    if (room.players.length !== 4) return this.fail(socket, "Isi 4 kursi dulu. Tambah bot atau undang teman.");

    const deck = this.shuffle(this.makeDeck());
    room.players.forEach((player, index) => {
      player.hand = deck.slice(index * 13, (index + 1) * 13).sort((a, b) => this.cardValue(a) - this.cardValue(b));
    });
    const starter = room.players.find((player) => player.hand.some((card) => card.rank === 3 && card.suit === "S"));
    const openingCards = [];
    for (const player of room.players) {
      openingCards.push(...player.hand.filter((card) => card.rank === 3));
      player.hand = player.hand.filter((card) => card.rank !== 3);
    }
    room.game = {
      turnId: starter.id,
      openingCards: openingCards.sort((a, b) => this.cardValue(a) - this.cardValue(b)),
      trick: null,
      passed: [],
      finished: false,
      winnerId: null,
      loserId: null,
      passCount: 0,
      pokerPlayed: false,
      twoLowInStraight: false,
    };
    await this.sendRoom(room);
    this.runBots(room);
    await this.sendRoom(room);
  }

  async playCards(socket, cardIds) {
    const playerId = socket.deserializeAttachment()?.playerId;
    const room = this.roomForPlayer(playerId);
    const game = room?.game;
    const player = room?.players.find((member) => member.id === playerId);
    if (!game || game.finished || !player || game.turnId !== player.id) return this.fail(socket, "Belum giliranmu.");
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 13) {
      return this.fail(socket, "Pilih kombinasi kartu yang valid.");
    }
    const selected = cardIds.map((id) => player.hand.find((card) => this.cardId(card) === id));
    if (selected.some((card) => !card)) return this.fail(socket, "Kartu yang dipilih tidak ada di tanganmu.");
    const combo = this.classify(selected, game.twoLowInStraight);
    if (!combo) return this.fail(socket, "Kombinasi tidak valid. Coba single, pair, triss, polo, atau bomb.");
    if (game.trick && !this.beats(combo, game.trick, game.twoLowInStraight)) {
      return this.fail(socket, "Kombinasi ini tidak bisa mengalahkan kartu di meja.");
    }
    this.applyPlay(room, player, selected, combo);
    this.runBots(room);
    await this.sendRoom(room);
  }

  async passTurn(socket) {
    const playerId = socket.deserializeAttachment()?.playerId;
    const room = this.roomForPlayer(playerId);
    const game = room?.game;
    const player = room?.players.find((member) => member.id === playerId);
    if (!game || game.finished || !player || game.turnId !== player.id) return this.fail(socket, "Belum giliranmu.");
    if (!game.trick) return this.fail(socket, "Kamu harus membuka permainan, tidak bisa pass.");

    game.passed.push(player.id);
    game.passCount += 1;
    if (game.passCount >= room.players.length - 1) {
      game.turnId = game.trick.playerId;
      game.trick = null;
      game.passed = [];
      game.passCount = 0;
    } else {
      game.turnId = this.nextPlayer(room, player.id, true).id;
    }
    this.runBots(room);
    await this.sendRoom(room);
  }

  async leave(socket, disconnected = false) {
    const playerId = socket.deserializeAttachment()?.playerId;
    const room = this.roomForPlayer(playerId);
    if (!room) return;
    const player = room.players.find((member) => member.id === playerId);
    if (room.game && !room.game.finished) {
      const botId = `bot-${crypto.randomUUID()}`;
      player.id = botId;
      player.bot = true;
      player.connected = true;
      if (room.game.turnId === playerId) room.game.turnId = botId;
      if (room.game.trick?.playerId === playerId) room.game.trick.playerId = botId;
      room.game.passed = room.game.passed.map((id) => id === playerId ? botId : id);
    } else {
      room.players = room.players.filter((member) => member.id !== playerId);
      if (room.hostId === playerId) room.hostId = room.players.find((member) => !member.bot)?.id || null;
      if (room.players.length === 0) delete this.rooms[room.code];
    }
    socket.serializeAttachment({ playerId: null });
    if (disconnected) {
      try {
        socket.close(1000, "Room left");
      } catch (error) {
        console.error("WebSocket close failed:", error);
      }
    }
    if (this.rooms[room.code]) {
      this.runBots(room);
      await this.sendRoom(room);
    } else {
      await this.save();
      this.broadcast("lobby", this.publicRooms());
    }
  }

  applyPlay(room, player, cards, combo) {
    const game = room.game;
    const previous = game.trick;
    if (combo.type === "bomb" && !game.pokerPlayed && !cards.some((card) => card.rank === 15)) {
      game.twoLowInStraight = true;
    }
    if (cards.some((card) => card.rank === 15)) game.pokerPlayed = true;
    player.hand = player.hand.filter((card) => !cards.some((played) => this.cardId(played) === this.cardId(card)));
    const bombedTwo = previous && previous.type === "single" &&
      previous.cards[0].rank === 15 && combo.type === "bomb";
    game.trick = { playerId: player.id, type: combo.type, cards };
    game.passed = [];
    game.passCount = 0;
    game.openingCards = null;
    if (bombedTwo) {
      game.finished = true;
      game.winnerId = player.id;
      game.loserId = previous.playerId;
    } else if (player.hand.length === 0) {
      game.finished = true;
      game.winnerId = player.id;
    } else {
      game.turnId = this.nextPlayer(room, player.id, false).id;
    }
  }

  runBots(room) {
    const game = room.game;
    let moves = 0;
    while (game && !game.finished && moves < 60) {
      const player = room.players.find((member) => member.id === game.turnId);
      if (!player?.bot) return;
      const previous = game.trick;
      const options = this.allCombos(player.hand, game.twoLowInStraight)
        .filter(({ combo }) => !previous || this.beats(combo, previous, game.twoLowInStraight));
      options.sort((a, b) => {
        const first = this.strength(a.combo, game.twoLowInStraight);
        const second = this.strength(b.combo, game.twoLowInStraight);
        for (let i = 0; i < Math.max(first.length, second.length); i += 1) {
          if ((first[i] || 0) !== (second[i] || 0)) return (first[i] || 0) - (second[i] || 0);
        }
        return a.cards.length - b.cards.length;
      });
      if (options.length === 0) {
        if (!previous) return;
        game.passed.push(player.id);
        game.passCount += 1;
        if (game.passCount >= room.players.length - 1) {
          game.turnId = game.trick.playerId;
          game.trick = null;
          game.passed = [];
          game.passCount = 0;
        } else {
          game.turnId = this.nextPlayer(room, player.id, true).id;
        }
      } else {
        this.applyPlay(room, player, options[0].cards, options[0].combo);
      }
      moves += 1;
    }
  }

  nextPlayer(room, currentId, skipPassed) {
    const index = room.players.findIndex((player) => player.id === currentId);
    for (let step = 1; step <= room.players.length; step += 1) {
      const player = room.players[(index + step) % room.players.length];
      if (!skipPassed || (!room.game.passed.includes(player.id) && player.id !== room.game.trick?.playerId)) {
        return player;
      }
    }
    return room.players[index];
  }

  allCombos(hand, twoLowInStraight) {
    const result = [];
    for (let i = 0; i < hand.length; i += 1) {
      result.push([hand[i]]);
      for (let j = i + 1; j < hand.length; j += 1) {
        result.push([hand[i], hand[j]]);
        for (let k = j + 1; k < hand.length; k += 1) {
          result.push([hand[i], hand[j], hand[k]]);
          for (let l = k + 1; l < hand.length; l += 1) result.push([hand[i], hand[j], hand[k], hand[l]]);
        }
      }
    }
    const byRank = new Map();
    for (const card of hand) {
      if (!byRank.has(card.rank)) byRank.set(card.rank, []);
      byRank.get(card.rank).push(card);
    }
    for (const tripleRank of RANKS) {
      const triples = byRank.get(tripleRank) || [];
      if (triples.length < 3) continue;
      for (const pairRank of RANKS) {
        const pairs = byRank.get(pairRank) || [];
        if (pairRank !== tripleRank && pairs.length >= 2) {
          result.push([...triples.slice(0, 3), ...pairs.slice(0, 2)]);
        }
      }
    }
    const cardsBySuitAndRank = new Map();
    for (const card of hand) {
      if (!cardsBySuitAndRank.has(card.suit)) cardsBySuitAndRank.set(card.suit, new Map());
      cardsBySuitAndRank.get(card.suit).set(card.rank, card);
    }
    const runOrder = this.straightOrder(twoLowInStraight);
    for (const suitCards of cardsBySuitAndRank.values()) {
      for (let start = 0; start < runOrder.length; start += 1) {
        const run = [];
        for (let end = start; end < runOrder.length; end += 1) {
          const card = suitCards.get(runOrder[end]);
          if (!card) break;
          run.push(card);
          if (run.length >= 3) result.push([...run]);
        }
      }
    }
    return result.map((cards) => ({ cards, combo: this.classify(cards, twoLowInStraight) }))
      .filter((item) => item.combo);
  }

  straightOrder(twoLowInStraight) {
    return twoLowInStraight ? [15, ...RANKS.filter((rank) => rank !== 15)] : RANKS.filter((rank) => rank !== 15);
  }

  classify(cards, twoLowInStraight = false) {
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 13) return null;
    if (new Set(cards.map((card) => this.cardId(card))).size !== cards.length) return null;
    if (cards.length >= 3 && new Set(cards.map((card) => card.suit)).size === 1) {
      const runOrder = this.straightOrder(twoLowInStraight);
      const sortedRanks = cards.map((card) => card.rank)
        .sort((a, b) => runOrder.indexOf(a) - runOrder.indexOf(b));
      const start = runOrder.indexOf(sortedRanks[0]);
      if (start >= 0 && sortedRanks.every((rank, index) => runOrder[start + index] === rank)) {
        return { type: "straight", cards: [...cards].sort((a, b) =>
          runOrder.indexOf(a.rank) - runOrder.indexOf(b.rank)
        ) };
      }
    }
    if (![1, 2, 3, 4, 5].includes(cards.length)) return null;
    const counts = new Map();
    for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const ordered = [...cards].sort((a, b) => this.cardValue(a) - this.cardValue(b));
    if (cards.length === 1) return { type: "single", cards: ordered };
    if (cards.length === 2 && groups[0][1] === 2) return { type: "pair", cards: ordered };
    if (cards.length === 3 && groups[0][1] === 3) return { type: "triple", cards: ordered };
    if (cards.length === 4 && groups[0][1] === 4) return { type: "bomb", cards: ordered };
    if (cards.length === 5 && groups[0][1] === 3 && groups[1][1] === 2) return { type: "polo", cards: ordered };
    return null;
  }

  strength(combo, twoLowInStraight = false) {
    const counts = new Map();
    for (const card of combo.cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const highestCard = Math.max(...combo.cards.map((card) => this.cardValue(card)));
    if (combo.type === "straight") {
      const topCard = combo.cards[combo.cards.length - 1];
      const topRank = topCard.rank === 15 && twoLowInStraight ? 2 : topCard.rank;
      return [topRank, this.cardValue(topCard)];
    }
    if (combo.type === "single") return [combo.cards[0].rank, highestCard];
    if (combo.type === "pair" || combo.type === "triple" || combo.type === "bomb") {
      return [groups[0][0], highestCard];
    }
    if (combo.type === "polo") return [groups[0][0], groups[1][0], highestCard];
    return [];
  }

  beats(candidate, previous, twoLowInStraight = false) {
    if (previous.type === "single" && previous.cards[0].rank === 15 && candidate.type === "bomb") return true;
    if (candidate.type !== previous.type) return false;
    if (candidate.type === "straight" && candidate.cards.length !== previous.cards.length) return false;
    const a = this.strength(candidate, twoLowInStraight);
    const b = this.strength(previous, twoLowInStraight);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  }

  makeDeck() {
    return RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
  }

  shuffle(cards) {
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  cardId(card) {
    return `${card.rank}${card.suit}`;
  }

  cardValue(card) {
    return card.rank * 4 + SUIT_VALUES[card.suit];
  }
}
