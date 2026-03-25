var WIN_PATTERNS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function checkWinner(board) {
  for (var i = 0; i < WIN_PATTERNS.length; i++) {
    var w = WIN_PATTERNS[i];
    if (board[w[0]] && board[w[0]] === board[w[1]] && board[w[0]] === board[w[2]]) {
      return board[w[0]];
    }
  }
  return board.indexOf(null) === -1 ? "draw" : null;
}

function loadStats(nk, userId) {
  var records = nk.storageRead([{ collection: "stats", key: userId, user_id: userId }]);
  if (!records || records.length === 0) {
    return { wins: 0, losses: 0, draws: 0, streak: 0 };
  }
  return records[0].value || { wins: 0, losses: 0, draws: 0, streak: 0 };
}

function writeStats(nk, userId, stats) {
  nk.storageWrite([{
    collection: "stats",
    key: userId,
    user_id: userId,
    value: stats,
    permissionRead: 2,
    permissionWrite: 1
  }]);
}

function updateStats(nk, userId, resultType) {
  var stats = loadStats(nk, userId);
  if (resultType === "win") {
    stats.wins += 1;
    stats.streak += 1;
  } else if (resultType === "loss") {
    stats.losses += 1;
    stats.streak = 0;
  } else if (resultType === "draw") {
    stats.draws += 1;
    stats.streak = 0;
  }
  writeStats(nk, userId, stats);
}

function matchInit(ctx, logger, nk, params) {
  return {
    state: {
      board: Array(9).fill(null),
      players: [],
      playerCount: 0,
      turn: "X",
      winner: null,
      mode: params.mode || "classic",
      moveTime: 30,
      lastMoveTime: Date.now()
    },
    tickRate: 1,
    label: "tic-tac-toe"
  };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presence) {
  if (state.players.indexOf(presence.user_id) !== -1) {
    return { state: state };
  }
  if (state.players.length >= 2) {
    return { state: state };
  }

  state.players.push(presence.user_id);
  state.playerCount = state.players.length;
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {

  if (state.players.length < 2) {
    // Wait for an opponent before enforcing timed forfeits
    return { state: state };
  }

  if (state.mode === "timed" &&
      Date.now() - state.lastMoveTime > state.moveTime * 1000) {

    state.winner = state.turn === "X" ? "O" : "X";
    var winnerId = state.players[state.turn === "X" ? 1 : 0];
    var loserId = state.players[state.turn === "X" ? 0 : 1];

    if (winnerId) updateStats(nk, winnerId, "win");
    if (loserId) updateStats(nk, loserId, "loss");
    if (winnerId && nk.leaderboardRecordWrite) {
      nk.leaderboardRecordWrite("leaderboard", winnerId, 1, 0, {});
    }

    dispatcher.broadcastMessage(1, JSON.stringify(state));
    return { state: state };
  }

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var data;
    try {
      data = JSON.parse(msg.data);
    } catch (err) {
      continue;
    }

    var pos = data.position;
    if (typeof pos !== "number" || pos < 0 || pos > 8) continue;
    if (state.board[pos] !== null || state.winner) continue;

    state.board[pos] = state.turn;

    var result = checkWinner(state.board);

    if (result) {
      state.winner = result;
      var winnerIndex = result === "X" ? 0 : 1;
      var loserIndex = winnerIndex === 0 ? 1 : 0;
      var winnerId = state.players[winnerIndex];
      var loserId = state.players[loserIndex];

      if (result !== "draw") {
        if (winnerId) updateStats(nk, winnerId, "win");
        if (loserId) updateStats(nk, loserId, "loss");
        if (winnerId && nk.leaderboardRecordWrite) {
          nk.leaderboardRecordWrite("leaderboard", winnerId, 1, 0, {});
        }
      } else {
        if (state.players[0]) updateStats(nk, state.players[0], "draw");
        if (state.players[1]) updateStats(nk, state.players[1], "draw");
      }
    } else {
      state.turn = state.turn === "X" ? "O" : "X";
    }

    state.lastMoveTime = Date.now();

    dispatcher.broadcastMessage(1, JSON.stringify(state));
  }

  return { state: state };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence) {
  // Allow joins only when there are fewer than 2 players
  return {
    state: state,
    accept: state.players.length < 2
  };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presence) {
  var idx = state.players.indexOf(presence.user_id);
  if (idx !== -1) state.players.splice(idx, 1);
  state.playerCount = state.players.length;
  return { state: state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return { state: state };
}

function InitModule(ctx, logger, nk, initializer) {

  initializer.registerMatch("tic-tac-toe", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLoop: matchLoop,
    matchLeave: matchLeave,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
  });

  if (initializer.registerLeaderboard) {
    initializer.registerLeaderboard(
      "leaderboard",
      true,
      "desc",
      "best",
      "set"
    );
    
    // Seed leaderboard with test data (optional: remove in production)
    nk.leaderboardRecordWrite("leaderboard", "seed-player-1", 50, 0, {});
    nk.leaderboardRecordWrite("leaderboard", "seed-player-2", 30, 0, {});
    nk.leaderboardRecordWrite("leaderboard", "seed-player-3", 10, 0, {});
  }
}