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

nameInput.value = localStorage.getItem("poker-name") || "";

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

document.getElementById("find-public").addEventListener("click", () => emitWithName("joinPublic"));
document.getElementById("create-public").addEventListener("click", () => emitWithName("createRoom", { privateRoom: false }));
document.getElementById("create-private").addEventListener("click", () => emitWithName("createRoom", { privateRoom: true }));
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
  document.getElementById("game-room-code").textContent = room.code;
  const me = room.players.find((player) => player.id === socket.id);
  const current = room.players.find((player) => player.id === game.turnId);
  document.getElementById("turn-pill").textContent = game.finished
    ? "GAME SELESAI"
    : current?.id === socket.id ? "GILIRAN KAMU" : `GILIRAN ${current?.name || "..."}`;
  document.getElementById("hand-count").textContent = `${me?.hand.length || 0} kartu`;
  document.getElementById("table-message").textContent = game.finished
    ? "Permainan selesai."
    : game.trick ? `${room.players.find((player) => player.id === game.trick.playerId)?.name || "Pemain"} mengeluarkan kartu`
      : game.opening ? "Pembuka wajib membawa 3♠" : "Meja kosong · giliran buka kombinasi";

  const tableCards = document.getElementById("played-cards");
  tableCards.replaceChildren();
  for (const card of game.trick?.cards || []) {
    const label = cardLabel(card);
    const element = document.createElement("div");
    element.className = `mini-card${label.red ? " red" : ""}`;
    element.textContent = `${label.rank}${label.suit}`;
    tableCards.append(element);
  }

  const opponents = document.getElementById("opponents");
  opponents.replaceChildren();
  const others = room.players.filter((player) => player.id !== socket.id);
  for (const player of others) {
    const seat = document.createElement("div");
    seat.className = `opponent${player.id === game.turnId ? " current" : ""}`;
    const name = document.createElement("span");
    name.className = "opponent-name";
    name.textContent = player.name;
    const backs = document.createElement("span");
    backs.className = "card-back-row";
    const count = Math.min(player.cardCount, 8);
    for (let i = 0; i < count; i += 1) {
      const back = document.createElement("i");
      back.className = "card-back";
      backs.append(back);
    }
    const cardCount = document.createElement("small");
    cardCount.textContent = `${player.cardCount} kartu`;
    seat.append(name, backs, cardCount);
    opponents.append(seat);
  }

  const result = document.getElementById("result-banner");
  result.hidden = !game.finished;
  if (game.finished) {
    const winner = room.players.find((player) => player.id === game.winnerId);
    const loser = room.players.find((player) => player.id === game.loserId);
    result.textContent = loser
      ? `${winner?.name || "Pemain"} nge-bomb! ${loser?.name || "Pemain"} kalah.`
      : `${winner?.name || "Pemain"} menang!`;
  }

  renderHand(me?.hand || [], game.finished || game.turnId !== socket.id);
  document.getElementById("play-cards").disabled = game.finished || game.turnId !== socket.id || !selectedCards.size;
  document.getElementById("pass-turn").disabled = game.finished || game.turnId !== socket.id || !game.trick;
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
