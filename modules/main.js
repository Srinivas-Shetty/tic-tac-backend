// ==============================
// MATCH HANDLER (SERVER AUTHORITATIVE)
// ==============================

var matchInit = function (ctx, logger, nk, params) {
  return {
    state: {
      board: Array(9).fill(""),
      players: {},
      turn: "X",
      winner: null,
      moveDeadline: 0
    },
    tickRate: 1,
    label: "tic-tac-toe",
  };
};

var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  presences.forEach(function (p) {
    if (Object.keys(state.players).length < 2) {
      state.players[p.userId] =
        Object.values(state.players).includes("X") ? "O" : "X";
    }
  });
  return { state: state };
};

var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
  var now = Date.now();

  // ⏱️ TIMER LOGIC (auto lose on timeout)
  if (state.moveDeadline && now > state.moveDeadline && !state.winner) {
    state.winner = state.turn === "X" ? "O" : "X";
  }

  messages.forEach(function (msg) {
    var data = JSON.parse(nk.binaryToString(msg.data));
    var userId = msg.sender.userId;
    var mark = state.players[userId];

    // ❌ validation (server authoritative)
    if (!mark || state.winner) return;
    if (mark !== state.turn) return;
    if (state.board[data.index] !== "") return;

    // ✅ apply move
    state.board[data.index] = mark;

    // 🏆 check winner
    var wins = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6],
    ];

    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if (
        state.board[w[0]] &&
        state.board[w[0]] === state.board[w[1]] &&
        state.board[w[1]] === state.board[w[2]]
      ) {
        state.winner = mark;
      }
    }

    // 🤝 draw condition
    if (!state.winner && state.board.every(function(cell){ return cell !== ""; })) {
      state.winner = "draw";
    }

    // 🔁 switch turn
    state.turn = state.turn === "X" ? "O" : "X";

    // ⏱️ reset timer
    state.moveDeadline = Date.now() + 30000;

    // 📡 broadcast updated state
    dispatcher.broadcastMessage(
      1,
      nk.stringToBinary(JSON.stringify(state))
    );
  });

  return { state: state };
};

var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  presences.forEach(function (p) {
    delete state.players[p.userId];
  });
  return { state: state };
};

var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state) {
  return { state: state };
};


// ==============================
// RPC FUNCTIONS
// ==============================

// 🎮 create match
var createMatch = function (ctx, logger, nk, payload) {
  var matchId = nk.matchCreate("match_handler", {});
  return JSON.stringify({ matchId: matchId });
};

// 🏆 update leaderboard
var updateLeaderboard = function (ctx, logger, nk, payload) {
  var data = JSON.parse(payload);

  nk.leaderboardRecordWrite(
    "tic_tac_toe",
    data.userId,
    data.userId,
    data.score,
    0
  );

  return JSON.stringify({ success: true });
};

// 📊 get leaderboard
var getLeaderboard = function (ctx, logger, nk, payload) {
  var records = nk.leaderboardRecordsList("tic_tac_toe", null, 10);
  return JSON.stringify(records);
};


// ==============================
// INIT MODULE (REGISTER EVERYTHING)
// ==============================

var InitModule = function (ctx, logger, nk, initializer) {

  // 🎮 match handler
  initializer.registerMatch("match_handler", {
    matchInit: matchInit,
    matchJoin: matchJoin,
    matchLoop: matchLoop,
    matchLeave: matchLeave,
    matchTerminate: matchTerminate
  });

  // 🔌 RPCs
  initializer.registerRpc("create_match", createMatch);
  initializer.registerRpc("update_leaderboard", updateLeaderboard);
  initializer.registerRpc("get_leaderboard", getLeaderboard);

  // 🏆 leaderboard setup (VERY IMPORTANT)
  initializer.registerLeaderboard({
    id: "tic_tac_toe",
    authoritative: true,
    sortOrder: "desc",
    operator: "best",
    resetSchedule: "",
  });
};