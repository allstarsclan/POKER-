const socket = createSocket();
const screens = {
  home: document.getElementById("home-screen"),
  room: document.getElementById("room-screen"),
  game: document.getElementById("game-screen"),
};
const nameInput = document.getElementById("player-name");
const selectedCards = new Set();
let currentRoom = null;
let toastTimer;
let selectedMode = "ronda";

nameInput.value = localStorage.getItem("poker-name") || "";

for (const button of document.querySelectorAll(".mode-choice")) {
  button.addEventListener("click", () => {
    selectedMode = button.dataset.mode;
    for (const choice of document.querySelectorAll(".mode-choice")) {
      const active = choice === button;
      choice.classList.toggle("selected", active);
      choice.setAttribute("aria-pressed", String(active));
    }
    document.getElementById("mode-description").textContent = selectedMode === "holdem"
      ? "Texas Hold’em pakai 100.000 chip virtual per pemain, blind 1.000 / 2.000."
      : "Poker Ronda dengan aturan kartu tongkrongan, termasuk bomb dan seri.";
  });
}

function showScreen(name) {
  for (const [key, element] of Object.entries(screens)) element.hidden = key !== name;
}

function playerName() {
  const name = nameInput.value.trim();
  if (!name) {
    showToast("Isi nama panggilan dulu ya.");
    nameInput.focus();
    return null;
  }
  localStorage.setItem("poker-name", name);
  return name;
}

function emitWithName(event, extra = {}) {
  const name = playerName();
  if (name) socket.emit(event, { ...extra, name });
}

document.getElementById("find-public").addEventListener("click", () => emitWithName("joinPublic", { mode: selectedMode }));
document.getElementById("create-public").addEventListener("click", () => emitWithName("createRoom", { privateRoom: false, mode: selectedMode }));
document.getElementById("create-private").addEventListener("click", () => emitWithName("createRoom", { privateRoom: true, mode: selectedMode }));
document.getElementById("join-room").addEventListener("click", () => {
  const code = document.getElementById("room-code").value.trim().toUpperCase();
  if (!code) return showToast("Masukkan kode room dulu.");
  emitWithName("joinRoom", { code });
});

function createSocket() {
  const handlers = new Map();
  const connection = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
  const client = {
    id: null,
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    emit(event, payload = {}) {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify({ event, payload }));
      }
    },
  };
  connection.addEventListener("open", () => {
    for (const handler of handlers.get("connect") || []) handler();
    client.emit("listLobby");
  });
  connection.addEventListener("message", ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      showToast("Pesan dari server tidak valid.");
      return;
    }
    for (const handler of handlers.get(message.event) || []) handler(message.payload);
  });
  connection.addEventListener("close", () => {
    for (const handler of handlers.get("disconnect") || []) handler();
  });
  connection.addEventListener("error", () => showToast("Koneksi ke server gagal."));
  return client;
}
document.getElementById("room-code").addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.getElementById("join-room").click();
});
document.getElementById("add-bots").addEventListener("click", () => socket.emit("addBots"));
document.getElementById("remove-bots").addEventListener("click", () => socket.emit("removeBots"));
document.getElementById("start-game").addEventListener("click", () => socket.emit("startGame"));
document.getElementById("leave-room").addEventListener("click", leaveRoom);
document.getElementById("leave-game").addEventListener("click", leaveRoom);
document.getElementById("play-cards").addEventListener("click", () => {
  if (!selectedCards.size) return showToast("Pilih kartu yang mau dimainkan.");
  socket.emit("playCards", { cards: [...selectedCards] });
});
document.getElementById("pass-turn").addEventListener("click", () => socket.emit("passTurn"));
document.getElementById("holdem-fold").addEventListener("click", () =>
  socket.emit("holdemAction", { action: "fold" }));
document.getElementById("holdem-check-call").addEventListener("click", () =>
  socket.emit("holdemAction", { action: "checkCall" }));
document.getElementById("holdem-raise").addEventListener("click", () =>
  socket.emit("holdemAction", {
    action: "raise",
    amount: Number(document.getElementById("holdem-raise-amount").value),
  }));

function leaveRoom() {
  socket.emit("leaveRoom");
  currentRoom = null;
  selectedCards.clear();
  showScreen("home");
}

socket.on("connect", () => showToast("Terhubung ke server."));
socket.on("session", ({ id }) => { socket.id = id; });
socket.on("disconnect", () => showToast("Koneksi terputus. Coba refresh halaman."));
socket.on("errorMessage", showToast);
socket.on("roomState", (room) => {
  currentRoom = room;
  selectedCards.clear();
  if (room.game) {
    showScreen("game");
    renderGame(room);
  } else {
    showScreen("room");
    renderRoom(room);
  }
});

socket.on("lobby", (rooms) => {
  const button = document.getElementById("find-public");
  const available = rooms.filter((room) => room.status === "waiting");
  button.lastChild.textContent = available.length ? ` ${available.length} meja menunggu →` : " →";
});

function renderRoom(room) {
  document.getElementById("room-code-title").textContent = room.code;
  document.getElementById("room-mode").textContent = room.mode === "holdem"
    ? "Texas Hold’em · chip virtual 100.000 · blind 1.000 / 2.000"
    : "Poker Ronda";
  document.getElementById("room-privacy").textContent = room.privateRoom
    ? "Privat · hanya teman dengan kode yang bisa bergabung"
    : "Publik · pemain lain bisa bergabung";
  document.getElementById("seat-count").textContent = `${room.players.length} / 4`;
  const list = document.getElementById("player-list");
  list.replaceChildren();
  for (const player of room.players) {
    const row = document.createElement("div");
    row.className = "player-row";
    const name = document.createElement("span");
    name.textContent = player.name;
    if (player.id === room.hostId) {
      const host = document.createElement("span");
      host.className = "player-tag";
      host.textContent = "host";
      name.append(host);
    }
    const tag = document.createElement("span");
    tag.className = "player-tag";
    tag.textContent = player.bot ? "bot" : player.connected ? "siap" : "terputus · bot lanjut";
    row.append(name, tag);
    list.append(row);
  }
  for (let i = room.players.length; i < 4; i += 1) {
    const row = document.createElement("div");
    row.className = "player-row empty-seat";
    row.textContent = `Kursi ${i + 1} · menunggu pemain`;
    list.append(row);
  }
  const isHost = room.hostId === socket.id;
  document.getElementById("add-bots").hidden = !isHost || room.players.length === 4;
  document.getElementById("remove-bots").hidden = !isHost || !room.players.some((player) => player.bot);
  document.getElementById("start-game").hidden = !isHost;
  document.getElementById("start-game").disabled = room.players.length !== 4;
  document.getElementById("host-note").textContent = isHost
    ? "Kamu host. Isi kursi dengan bot atau tunggu teman masuk."
    : "Tunggu host memulai permainan.";
}

function cardLabel(card) {
  const rank = card.rank <= 10 ? String(card.rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" })[card.rank];
  return { rank, suit: ({ D: "♦", C: "♣", H: "♥", S: "♠" })[card.suit], red: card.suit === "D" || card.suit === "H" };
}

function renderGame(room) {
  const game = room.game;
  const holdem = game.mode === "holdem";
  document.getElementById("game-room-code").textContent = room.code;
  const me = room.players.find((player) => player.id === socket.id);
  const myState = room.playerStates?.find((player) => player.id === socket.id);
  const current = room.players.find((player) => player.id === game.turnId);
  document.getElementById("turn-pill").textContent = game.finished
    ? "GAME SELESAI"
    : current?.id === socket.id ? "GILIRAN KAMU" : `GILIRAN ${current?.name || "..."}`;
  document.getElementById("hand-count").textContent = holdem
    ? `${me?.hand.length || 0} kartu hole · ${(myState?.stack || 0).toLocaleString("id-ID")} chip`
    : `${me?.hand.length || 0} kartu`;
  document.getElementById("table-message").textContent = game.finished
    ? "Permainan selesai."
    : holdem ? ({ preflop: "Pre-flop · pilih aksi", flop: "Flop · pilih aksi", turn: "Turn · pilih aksi", river: "River · pilih aksi", showdown: "Showdown" })[game.stage]
      : game.trick ? `${room.players.find((player) => player.id === game.trick.playerId)?.name || "Pemain"} mengeluarkan kartu`
      : game.openingCards?.length ? "Semua kartu 3 dibuang. Pemegang 3♠ mulai."
        : "Meja kosong · giliran buka kombinasi";

  const tableCards = document.getElementById("played-cards");
  tableCards.replaceChildren();
  const visibleCards = holdem ? game.board || [] : game.trick?.cards || game.openingCards || [];
  for (const card of visibleCards) {
    const label = cardLabel(card);
    const element = document.createElement("div");
    element.className = `mini-card${label.red ? " red" : ""}`;
    element.textContent = `${label.rank}${label.suit}`;
    tableCards.append(element);
  }
  const comboNames = { single: "single", pair: "pair", triple: "triss", polo: "polo", bomb: "bomb", straight: "seri" };
  document.getElementById("combo-label").textContent = holdem
    ? game.winningHand || (game.board?.length ? `${game.board.length} kartu community` : "Menunggu flop")
    : game.trick
    ? comboNames[game.trick.type]
    : game.openingCards?.length ? "kartu 3 dibuang"
      : game.twoLowInStraight ? "seri bisa diawali 2" : "";
  document.getElementById("holdem-table-info").hidden = !holdem;
  document.getElementById("holdem-pot").textContent =
    (game.finished ? game.lastPot || 0 : game.pot || 0).toLocaleString("id-ID");
  document.getElementById("holdem-stage").textContent = holdem
    ? String(game.stage || "").toUpperCase() : "";

  const opponents = document.getElementById("opponents");
  opponents.replaceChildren();
  const others = room.players.filter((player) => player.id !== socket.id);
  for (const player of others) {
    const playerState = room.playerStates?.find((state) => state.id === player.id);
    const seat = document.createElement("div");
    seat.className = `opponent${player.id === game.turnId ? " current" : ""}`;
    const name = document.createElement("span");
    name.className = "opponent-name";
    name.textContent = player.name;
    const backs = document.createElement("span");
    if (holdem && game.finished && !playerState?.folded && player.hand.length) {
      backs.className = "opponent-hole";
      for (const card of player.hand) {
        const label = cardLabel(card);
        const face = document.createElement("span");
        face.className = `mini-card opponent-mini-card${label.red ? " red" : ""}`;
        face.textContent = `${label.rank}${label.suit}`;
        backs.append(face);
      }
    } else {
      backs.className = "card-back-row";
      const count = Math.min(holdem ? (playerState?.folded ? 0 : 2) : player.cardCount, 8);
      for (let i = 0; i < count; i += 1) {
        const back = document.createElement("i");
        back.className = "card-back";
        backs.append(back);
      }
    }
    const cardCount = document.createElement("small");
    cardCount.textContent = holdem
      ? playerState?.folded ? "fold" : `${(playerState?.stack || 0).toLocaleString("id-ID")} chip · bet ${(playerState?.roundBet || 0).toLocaleString("id-ID")}`
      : `${player.cardCount} kartu`;
    seat.append(name, backs, cardCount);
    if (playerState?.folded) seat.classList.add("folded");
    opponents.append(seat);
  }

  const result = document.getElementById("result-banner");
  result.hidden = !game.finished;
  if (game.finished) {
    const winner = room.players.find((player) => player.id === game.winnerId);
    const loser = room.players.find((player) => player.id === game.loserId);
    result.textContent = holdem
      ? `${(game.winnerIds || [game.winnerId]).map((id) => room.players.find((player) => player.id === id)?.name || "Pemain").join(" & ")} menang · ${game.winningHand || "pot"}`
      : loser
        ? `${winner?.name || "Pemain"} nge-bomb! ${loser?.name || "Pemain"} kalah.`
        : `${winner?.name || "Pemain"} menang!`;
  }

  renderHand(me?.hand || [], game.finished || game.turnId !== socket.id || holdem);
  document.getElementById("selection-hint").hidden = holdem;
  document.getElementById("ronda-actions").hidden = holdem;
  document.getElementById("holdem-actions").hidden = !holdem;
  document.getElementById("play-cards").disabled = game.finished || game.turnId !== socket.id || !selectedCards.size;
  document.getElementById("pass-turn").disabled = game.finished || game.turnId !== socket.id || !game.trick;
  const canAct = holdem && !game.finished && game.turnId === socket.id;
  const due = Math.max(0, (game.currentBet || 0) - (myState?.roundBet || 0));
  document.getElementById("holdem-fold").disabled = !canAct;
  document.getElementById("holdem-check-call").disabled =
    !canAct || (due > 0 && due >= (myState?.stack || 0));
  document.getElementById("holdem-check-call").textContent = due ? `Call ${due.toLocaleString("id-ID")}` : "Check";
  const raiseInput = document.getElementById("holdem-raise-amount");
  if (document.activeElement !== raiseInput) {
    raiseInput.min = String((game.currentBet || 0) + (game.minRaise || 2000));
    raiseInput.value = raiseInput.min;
  }
  const maxRaise = (myState?.roundBet || 0) + (myState?.stack || 0) - 1;
  raiseInput.max = String(maxRaise);
  document.getElementById("holdem-raise").disabled =
    !canAct || maxRaise < (game.currentBet || 0) + (game.minRaise || 2000);
}

function renderHand(hand, disabled) {
  const container = document.getElementById("hand");
  container.replaceChildren();
  for (const card of hand) {
    const id = `${card.rank}${card.suit}`;
    const label = cardLabel(card);
    const button = document.createElement("button");
    button.className = `playing-card${label.red ? " red" : ""}${selectedCards.has(id) ? " selected" : ""}`;
    button.disabled = disabled;
    button.setAttribute("aria-label", `${label.rank} ${card.suit}`);
    const rank = document.createElement("span");
    rank.textContent = label.rank;
    const suit = document.createElement("small");
    suit.textContent = label.suit;
    button.append(rank, suit);
    button.addEventListener("click", () => {
      if (selectedCards.has(id)) selectedCards.delete(id);
      else selectedCards.add(id);
      renderGame(currentRoom);
    });
    container.append(button);
  }
  document.getElementById("selection-hint").textContent = selectedCards.size
    ? `${selectedCards.size} kartu dipilih`
    : "Pilih kartu untuk dimainkan";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}
