var TICK_RATE = 1;
var TURN_TIME_MS = 30 * 1000;
var LEADERBOARD_ID = "tic_tac_toe";

function emptyBoard() {
  return ["", "", "", "", "", "", "", "", ""];
}

function winningCombos() {
  return [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];
}

function checkWinner(board) {
  var combos = winningCombos();
  for (var i = 0; i < combos.length; i++) {
    var c = combos[i];
    if (
      board[c[0]] !== "" &&
      board[c[0]] === board[c[1]] &&
      board[c[1]] === board[c[2]]
    ) {
      return {
        winner: board[c[0]],
        line: c
      };
    }
  }
  return null;
}

function isBoardFull(board) {
  for (var i = 0; i < board.length; i++) {
    if (board[i] === "") return false;
  }
  return true;
}

function toClientState(state) {
  return {
    board: state.board,
    players: state.players,
    usernames: state.usernames,
    turn: state.turn,
    winner: state.winner,
    winLine: state.winLine,
    moveDeadline: state.moveDeadline
  };
}

function broadcastState(nk, dispatcher, state) {
  dispatcher.broadcastMessage(
    1,
    nk.stringToBinary(JSON.stringify(toClientState(state)))
  );
}

function getOpponentMark(mark) {
  return mark === "X" ? "O" : "X";
}

function getRemainingPlayerMark(state) {
  var userIds = Object.keys(state.players);
  if (userIds.length === 1) {
    return state.players[userIds[0]];
  }
  return null;
}

// ==============================
// MATCH HANDLER
// ==============================

var matchInit = function (ctx, logger, nk, params) {
  return {
    state: {
      board: emptyBoard(),
      players: {},      // userId -> X/O
      usernames: {},    // userId -> username
      presences: {},    // userId -> presence
      turn: "X",
      winner: null,
      winLine: null,
      moveDeadline: 0
    },
    tickRate: TICK_RATE,
    label: "tic-tac-toe"
  };
};

var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (Object.keys(state.players).length >= 2) {
    return {
      state: state,
      accept: false,
      rejectMessage: "Match is full"
    };
  }

  return {
    state: state,
    accept: true
  };
};

var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];

    state.presences[p.userId] = p;
    state.usernames[p.userId] = p.username || "Player";

    if (!state.players[p.userId] && Object.keys(state.players).length < 2) {
      var existingMarks = Object.keys(state.players).map(function (uid) {
        return state.players[uid];
      });
      state.players[p.userId] = existingMarks.indexOf("X") === -1 ? "X" : "O";
    }
  }

  if (Object.keys(state.players).length === 2 && state.moveDeadline === 0 && !state.winner) {
    state.moveDeadline = Date.now() + TURN_TIME_MS;
  }

  broadcastState(nk, dispatcher, state);

  return { state: state };
};

var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    delete state.presences[p.userId];

    if (!state.winner && state.players[p.userId]) {
      var leavingMark = state.players[p.userId];
      state.winner = getOpponentMark(leavingMark);
    }

    delete state.players[p.userId];
    delete state.usernames[p.userId];
  }

  broadcastState(nk, dispatcher, state);

  return { state: state };
};

var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
  var now = Date.now();

  if (state.moveDeadline > 0 && !state.winner && now >= state.moveDeadline) {
    state.winner = getOpponentMark(state.turn);
    broadcastState(nk, dispatcher, state);
    return { state: state };
  }

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];

    if (msg.opCode !== 1) {
      continue;
    }

    var data;
    try {
      data = JSON.parse(nk.binaryToString(msg.data));
    } catch (err) {
      logger.error("Invalid match data: %v", err);
      continue;
    }

    var userId = msg.sender.userId;
    var mark = state.players[userId];

    if (!mark || state.winner) {
      continue;
    }

    if (mark !== state.turn) {
      continue;
    }

    if (typeof data.index !== "number" || data.index < 0 || data.index > 8) {
      continue;
    }

    if (state.board[data.index] !== "") {
      continue;
    }

    state.board[data.index] = mark;

    var result = checkWinner(state.board);
    if (result) {
      state.winner = result.winner;
      state.winLine = result.line;
    } else if (isBoardFull(state.board)) {
      state.winner = "draw";
      state.winLine = null;
    } else {
      state.turn = getOpponentMark(state.turn);
      state.moveDeadline = Date.now() + TURN_TIME_MS;
    }

    broadcastState(nk, dispatcher, state);
  }

  return { state: state };
};

var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state: state };
};

var matchSignal = function (ctx, logger, nk, dispatcher, tick, state, data) {
  return {
    state: state,
    data: data
  };
};

// ==============================
// RPC FUNCTIONS
// ==============================

var createMatch = function (ctx, logger, nk, payload) {
  var matchId = nk.matchCreate("match_handler", {});
  return JSON.stringify({ matchId: matchId });
};

var updateLeaderboard = function (ctx, logger, nk, payload) {
  if (!ctx.userId) {
    throw new Error("User not authenticated");
  }

  var data = {};
  if (payload && payload !== "") {
    data = JSON.parse(payload);
  }

  var score = Number(data.score || 0);

  nk.leaderboardRecordWrite(
    LEADERBOARD_ID,
    ctx.userId,
    ctx.username || "",
    score,
    0,
    {},
    true
  );

  return JSON.stringify({ success: true });
};

var getLeaderboard = function (ctx, logger, nk, payload) {
  var records = nk.leaderboardRecordsList(
    LEADERBOARD_ID,
    null,
    10,
    "",
    null
  );

  return JSON.stringify(records);
};

// ==============================
// INIT MODULE
// ==============================

var InitModule = function (ctx, logger, nk, initializer) {
  initializer.registerMatch("match_handler", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
  });

  initializer.registerRpc("create_match", createMatch);
  initializer.registerRpc("update_leaderboard", updateLeaderboard);
  initializer.registerRpc("get_leaderboard", getLeaderboard);

  try {
    nk.leaderboardCreate(
      LEADERBOARD_ID,
      true,
      "desc",
      "best",
      "",
      {},
      true
    );
  } catch (e) {
    logger.info("Leaderboard already exists or could not be created: %v", e);
  }

  logger.info("Tic-Tac-Toe module loaded successfully.");
};
