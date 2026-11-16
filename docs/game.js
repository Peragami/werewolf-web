"use strict";
/* ============================================================
   役職もりもり人狼 Web版
   同期: Firebase Realtime Database（HTTPS RESTのみ・SDK不使用）
   ルームは /rooms/wolf-<CODE> に置く（リバーシと名前空間を分離）
   進行はホストの端末が管理する（サーバーレス）
   ============================================================ */

const DB_URL = "https://muze-reversi-default-rtdb.asia-southeast1.firebasedatabase.app";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_PREFIX = "wolf-";

const ROLES = {
  wolf:     { name: "人狼",   team: "wolf",     icon: "🐺", desc: "毎夜、村人1人を襲撃する。人狼同士は互いの正体が分かる。全員で同じ相手を狙うと確実。" },
  madman:   { name: "狂人",   team: "wolf",     icon: "🃏", desc: "人狼側の人間。占いでは「人間」と出る。人狼が勝てば一緒に勝利。" },
  seer:     { name: "占い師", team: "villager", icon: "🔮", desc: "毎夜1人を占い、人狼かどうか分かる。妖狐を占うと呪殺してしまう。" },
  medium:   { name: "霊媒師", team: "villager", icon: "🕯️", desc: "前日の昼に追放された人が人狼だったかどうか、夜に分かる。" },
  knight:   { name: "騎士",   team: "villager", icon: "🛡️", desc: "毎夜1人を護衛して襲撃から守る。自分は守れない。同じ人を続けて守ることもできる。" },
  fox:      { name: "妖狐",   team: "fox",      icon: "🦊", desc: "第三陣営。襲撃では死なないが、占われると呪殺される。ゲーム終了時に生き残っていれば単独勝利。" },
  villager: { name: "村人",   team: "villager", icon: "🧑‍🌾", desc: "特殊な能力はない。議論と投票で人狼を見つけ出す。" },
};
const ROLE_KEYS = ["wolf", "seer", "medium", "knight", "madman", "fox"]; // 村人は残り
const COMP_TABLE = {
  5:  { wolf: 1, seer: 1, medium: 0, knight: 0, madman: 0, fox: 0 },
  6:  { wolf: 1, seer: 1, medium: 0, knight: 1, madman: 0, fox: 0 },
  7:  { wolf: 2, seer: 1, medium: 0, knight: 1, madman: 0, fox: 0 },
  8:  { wolf: 2, seer: 1, medium: 1, knight: 1, madman: 0, fox: 0 },
  9:  { wolf: 2, seer: 1, medium: 1, knight: 1, madman: 1, fox: 0 },
  10: { wolf: 2, seer: 1, medium: 1, knight: 1, madman: 1, fox: 1 },
  11: { wolf: 3, seer: 1, medium: 1, knight: 1, madman: 1, fox: 1 },
  12: { wolf: 3, seer: 1, medium: 1, knight: 1, madman: 1, fox: 1 },
};
const BOT_NAMES = ["ボブ", "アリス", "ケン", "ミサキ", "ゴロウ", "ユイ", "タロウ", "ハナ", "ジン", "リン", "ソラ", "カイ"];

/* ---------------- Firebase REST（単純リクエスト方式） ---------------- */
async function fb(path, method, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  try {
    const opt = { method, signal: ctrl.signal };
    if (body !== undefined) {
      opt.headers = { "Content-Type": "text/plain" };
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(DB_URL + path, opt);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  } finally {
    clearTimeout(t);
  }
}
const roomPath = (code) => "/rooms/" + ROOM_PREFIX + code + ".json";
const subPath = (code, s) => "/rooms/" + ROOM_PREFIX + code + s;

/* ---------------- 自分の情報 ---------------- */
let myPid = localStorage.getItem("wolf_pid") || "";
if (!myPid) {
  myPid = "p" + Math.random().toString(36).slice(2, 10);
  localStorage.setItem("wolf_pid", myPid);
}
let myName = localStorage.getItem("wolf_name") || "";
let roomCode = "";
let room = null;
let pollTimer = null;
let hostTimer = null;
let clockTimer = null;
let lastPhaseSeq = -1;
const botActedFor = {}; // phaseSeq -> true（ホストのBot実行済み管理）

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const playersArr = () => Object.entries((room && room.players) || {}).map(([pid, p]) => ({ pid, ...p }));
const aliveArr = () => playersArr().filter((p) => p.alive);
const me = () => (room && room.players && room.players[myPid]) || null;
const isHost = () => !!room && room.host === myPid;
const roleOf = (pid) => room && room.players && room.players[pid] ? room.players[pid].role : null;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function genCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function logEntry(text, kind) {
  return { ts: Date.now(), text, kind: kind || "info" };
}

/* ---------------- ルーム作成・参加 ---------------- */
function readName() {
  myName = $("nameInput").value.trim();
  if (!myName) { $("homeError").textContent = "名前を入力してください。"; return false; }
  localStorage.setItem("wolf_name", myName);
  return true;
}

async function createRoom() {
  if (!readName()) return;
  $("homeError").textContent = "";
  $("createBtn").disabled = true;
  try {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code = genCode();
      const existing = await fb(roomPath(code), "GET");
      if (!existing) break;
      code = "";
    }
    if (!code) throw new Error("コード生成に失敗しました。再試行してください。");
    const data = {
      v: 1, game: "werewolf", status: "lobby", host: myPid, createdAt: Date.now(),
      config: { target: 8, botFill: true, discussSec: 180, nightSec: 90, comp: { ...COMP_TABLE[8] } },
      players: { [myPid]: { name: myName, bot: false, alive: true, role: null, hb: Date.now() } },
      day: 0, phaseSeq: 0, phaseEndsAt: 0,
      log: [logEntry("ルームが作成されました。コードを友達に伝えてください。", "sys")],
      winner: null, winReason: "",
    };
    await fb(roomPath(code), "PUT", data);
    enterRoom(code);
  } catch (e) {
    $("homeError").textContent = "ルーム作成に失敗しました：通信を確認して再試行してください。";
  } finally {
    $("createBtn").disabled = false;
  }
}

async function joinRoom() {
  if (!readName()) return;
  const code = $("joinCodeInput").value.trim().toUpperCase();
  if (code.length !== 6) { $("homeError").textContent = "ルームコードは6文字です。"; return; }
  $("homeError").textContent = "";
  $("joinBtn").disabled = true;
  try {
    const data = await fb(roomPath(code), "GET");
    if (!data) { $("homeError").textContent = "そのコードのルームは見つかりませんでした。"; return; }
    const already = data.players && data.players[myPid];
    if (data.status !== "lobby" && !already) { $("homeError").textContent = "そのルームはすでにゲーム中です。"; return; }
    if (!already) {
      const count = Object.keys(data.players || {}).length;
      if (count >= 12) { $("homeError").textContent = "そのルームは満員です（12人まで）。"; return; }
      await fb(subPath(code, "/players/" + myPid + ".json"), "PUT",
        { name: myName, bot: false, alive: true, role: null, hb: Date.now() });
    }
    enterRoom(code);
  } catch (e) {
    $("homeError").textContent = "参加に失敗しました：通信を確認して再試行してください。";
  } finally {
    $("joinBtn").disabled = false;
  }
}

function enterRoom(code) {
  roomCode = code;
  localStorage.setItem("wolf_room", code);
  lastPhaseSeq = -1;
  if (pollTimer) clearInterval(pollTimer);
  if (hostTimer) clearInterval(hostTimer);
  if (clockTimer) clearInterval(clockTimer);
  pollTimer = setInterval(poll, 2000);
  hostTimer = setInterval(hostTick, 1000);
  clockTimer = setInterval(updateClock, 250);
  poll();
}

async function leaveRoom(deleteRoom) {
  const code = roomCode;
  stopTimers();
  if (code) {
    try {
      if (deleteRoom) await fb(roomPath(code), "DELETE");
      else if (room && room.status === "lobby") await fb(subPath(code, "/players/" + myPid + ".json"), "DELETE");
    } catch (e) { /* 退出処理の失敗は無視 */ }
  }
  roomCode = ""; room = null;
  localStorage.removeItem("wolf_room");
  showScreen("home");
  $("roomInfo").classList.add("hidden");
}

function stopTimers() {
  if (pollTimer) clearInterval(pollTimer);
  if (hostTimer) clearInterval(hostTimer);
  if (clockTimer) clearInterval(clockTimer);
  pollTimer = hostTimer = clockTimer = null;
}

async function poll() {
  if (!roomCode) return;
  try {
    const data = await fb(roomPath(roomCode), "GET");
    if (!data) { // ルームが消えた（ホスト解散など）
      stopTimers();
      roomCode = ""; room = null;
      localStorage.removeItem("wolf_room");
      showScreen("home");
      $("roomInfo").classList.add("hidden");
      $("homeError").textContent = "ルームが解散されました。";
      return;
    }
    room = data;
    render();
    // ハートビート（自分の生存をホストに知らせる）
    if (me() && !me().bot) {
      fb(subPath(roomCode, "/players/" + myPid + "/hb.json"), "PUT", Date.now()).catch(() => {});
    }
  } catch (e) { /* 一時的な通信失敗は次回ポーリングで回復 */ }
}

function showScreen(name) {
  ["home", "lobby", "game", "result"].forEach((s) => {
    $("screen-" + s).classList.toggle("hidden", s !== name);
  });
}

function updateClock() {
  if (!room || !room.phaseEndsAt) { $("timerLabel").textContent = ""; return; }
  const left = Math.max(0, Math.round((room.phaseEndsAt - Date.now()) / 1000));
  $("timerLabel").textContent = "⏱ " + left + "秒";
}

/* ---------------- 描画 ---------------- */
const PHASE_LABEL = {
  lobby: "ロビー", reveal: "役職確認", night: "夜", dawn: "朝",
  day: "昼・議論", vote: "投票", exile: "追放結果", finished: "終了",
};
let lobbySig = "";
let roleSig = "";

function render() {
  if (!room) return;
  $("roomInfo").classList.remove("hidden");
  $("roomCodeLabel").textContent = roomCode;
  const st = room.status;
  $("phaseLabel").textContent =
    (st === "night" || st === "dawn" || st === "day" || st === "vote" || st === "exile")
      ? room.day + "日目・" + PHASE_LABEL[st]
      : PHASE_LABEL[st] || st;

  if (st === "lobby") { showScreen("lobby"); renderLobby(); }
  else if (st === "finished") { showScreen("result"); renderResult(); }
  else { showScreen("game"); renderGame(); }
  renderChat();
  if (room.phaseSeq !== lastPhaseSeq) {
    lastPhaseSeq = room.phaseSeq;
    const el = $("eventLog");
    if (el) el.scrollTop = el.scrollHeight;
  }
}

function renderLobby() {
  $("lobbyCode").textContent = roomCode;
  const arr = playersArr();
  $("memberCount").textContent = "（" + arr.length + "人）";
  $("memberList").innerHTML = arr.map((p) =>
    "<li><span>" + esc(p.name) + (p.pid === myPid ? "（あなた）" : "") + "</span>" +
    "<span>" + (room.host === p.pid ? '<span class="tag host">ホスト</span>' : "") +
    (p.bot ? '<span class="tag">Bot</span>' : "") + "</span></li>"
  ).join("");

  const host = isHost();
  $("hostConfig").classList.toggle("hidden", !host);
  $("lobbyWait").classList.toggle("hidden", host);
  if (!host) return;

  const cfg = room.config;
  const sig = JSON.stringify(cfg) + "|" + arr.length;
  if (sig !== lobbySig) {
    lobbySig = sig;
    const sel = $("targetSel");
    sel.innerHTML = [5, 6, 7, 8, 9, 10, 11, 12].map((n) =>
      '<option value="' + n + '"' + (cfg.target === n ? " selected" : "") + ">" + n + "人</option>").join("");
    $("botFillChk").checked = !!cfg.botFill;
    $("discussSel").value = String(cfg.discussSec);
    $("nightSel").value = String(cfg.nightSec);
    renderCompEditor();
  }
}

function compVillagers() {
  const cfg = room.config;
  const used = ROLE_KEYS.reduce((s, k) => s + (cfg.comp[k] || 0), 0);
  return cfg.target - used;
}

function renderCompEditor() {
  const cfg = room.config;
  $("compEditor").innerHTML = ROLE_KEYS.map((k) => {
    const r = ROLES[k];
    return '<div class="comp-row"><span class="nm">' + r.icon + " " + r.name + '</span>' +
      '<span class="ctl"><button data-comp="' + k + '" data-d="-1">−</button>' +
      '<span class="num">' + (cfg.comp[k] || 0) + "</span>" +
      '<button data-comp="' + k + '" data-d="1">＋</button></span></div>';
  }).join("");
  const v = compVillagers();
  $("compSummary").textContent =
    "構成：" + ROLE_KEYS.map((k) => ROLES[k].name + (cfg.comp[k] || 0)).join("・") +
    "・村人" + v + "（合計" + cfg.target + "人）" +
    (v < 0 ? "　⚠ 役職が人数を超えています" : "");
  $("compEditor").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", async () => {
      const k = b.getAttribute("data-comp");
      const d = parseInt(b.getAttribute("data-d"), 10);
      const next = Math.max(0, Math.min(6, (room.config.comp[k] || 0) + d));
      try {
        await fb(subPath(roomCode, "/config/comp/" + k + ".json"), "PUT", next);
        lobbySig = ""; // 次回pollで再描画させるため即時反映
        room.config.comp[k] = next;
        renderCompEditor();
      } catch (e) { /* 通信失敗時はpollで戻る */ }
    });
  });
}

function myHistoryHtml() {
  const my = me();
  if (!my || !my.role) return "";
  let html = "";
  if (my.role === "wolf") {
    const mates = playersArr().filter((p) => p.role === "wolf" && p.pid !== myPid);
    if (mates.length) html += "<div>仲間の人狼：" + mates.map((p) => esc(p.name)).join("、") + "</div>";
  }
  const sh = (room.seerHistory && room.seerHistory[myPid]) || [];
  if (my.role === "seer" && sh.length) {
    html += "<div>占い履歴：" + sh.map((h) => h.day + "日目 " + esc(h.targetName) + "→" + (h.result === "wolf" ? "人狼" : "人間")).join(" ／ ") + "</div>";
  }
  const mh = (room.mediumHistory && room.mediumHistory[myPid]) || [];
  if (my.role === "medium" && mh.length) {
    html += "<div>霊媒履歴：" + mh.map((h) => h.day + "日目 追放の" + esc(h.targetName) + "→" + (h.result === "wolf" ? "人狼だった" : "人狼ではなかった")).join(" ／ ") + "</div>";
  }
  return html ? '<div class="role-history">' + html + "</div>" : "";
}

function renderGame() {
  const my = me();
  // 役職カード
  const rsig = (my ? my.role : "") + "|" + room.day + "|" + JSON.stringify(room.seerHistory || {}) + "|" + JSON.stringify(room.mediumHistory || {});
  if (my && my.role && rsig !== roleSig) {
    roleSig = rsig;
    const r = ROLES[my.role];
    const teamName = r.team === "wolf" ? "人狼陣営" : r.team === "fox" ? "妖狐（第三陣営）" : "村人陣営";
    $("myRoleCard").className = "card role-card " + r.team;
    $("myRoleCard").innerHTML =
      '<div class="role-name">' + r.icon + " あなたは「" + r.name + "」</div>" +
      '<div class="role-team">' + teamName + (my.alive ? "" : " ／ あなたは死亡しています") + "</div>" +
      "<p class='note'>" + r.desc + "</p>" + myHistoryHtml();
  } else if (my && !my.role) {
    $("myRoleCard").innerHTML = '<div class="phase-title">役職の配布を待っています…</div>';
  }

  renderPhasePanel();

  // プレイヤー一覧
  $("playerGrid").innerHTML = playersArr().map((p) => {
    let st = p.alive ? "生存" : "死亡";
    if (p.pid === room.host) st += "・ホスト";
    if (p.bot) st += "・Bot";
    let roleMark = "";
    if (me() && me().role === "wolf" && p.role === "wolf") roleMark = ' <span class="tag">🐺人狼</span>';
    return '<div class="player-cell' + (p.alive ? "" : " dead") + (p.pid === myPid ? " me" : "") + '">' +
      "<div>" + esc(p.name) + (p.pid === myPid ? "（あなた）" : "") + roleMark + "</div>" +
      '<div class="st">' + st + "</div></div>";
  }).join("");

  // 経過ログ
  $("eventLog").innerHTML = (room.log || []).map((l) =>
    '<div class="' + esc(l.kind || "") + '">' + esc(l.text) + "</div>").join("");
}

function targetButtons(targets, selectedPid, dataAttr) {
  return '<div class="target-list">' + targets.map((p) =>
    '<button data-' + dataAttr + '="' + p.pid + '"' + (selectedPid === p.pid ? ' class="selected"' : "") + ">" +
    esc(p.name) + (p.bot ? "（Bot）" : "") + "</button>").join("") + "</div>";
}

function renderPhasePanel() {
  const panel = $("phasePanel");
  const my = me();
  const st = room.status;
  const night = room.night || {};
  const actions = night.actions || {};
  let html = "";

  if (st === "reveal") {
    html = '<div class="phase-title">🎴 役職が配られました</div>' +
      '<p class="phase-desc">上のカードで自分の役職を確認してください。ホストが進めると最初の夜が始まります。</p>';
    if (isHost()) html += '<button id="toNightBtn" class="primary">最初の夜へ進む</button>';
  }
  else if (st === "night") {
    html = '<div class="phase-title">🌙 ' + room.day + '日目の夜</div>';
    if (!my || !my.alive) {
      html += '<p class="phase-desc">あなたは行動できません。夜が明けるのを待ってください。</p>';
    } else if (my.role === "wolf") {
      const targets = aliveArr().filter((p) => p.role !== "wolf");
      const myAct = actions[myPid];
      const mateActs = playersArr().filter((p) => p.role === "wolf" && p.alive)
        .map((p) => esc(p.name) + "：" + (actions[p.pid] ? "選択済み" : "未選択")).join(" ／ ");
      html += '<p class="phase-desc">襲撃する相手を1人選んでください（人狼全員の多数決で決まります）。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target") +
        '<div class="vote-status">人狼の選択状況：' + mateActs + "</div>";
    } else if (my.role === "seer") {
      const targets = aliveArr().filter((p) => p.pid !== myPid);
      const myAct = actions[myPid];
      html += '<p class="phase-desc">占う相手を1人選んでください。結果は朝に分かります。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target");
    } else if (my.role === "knight") {
      const targets = aliveArr().filter((p) => p.pid !== myPid);
      const myAct = actions[myPid];
      html += '<p class="phase-desc">護衛する相手を1人選んでください（前夜と同じ人でもOK）。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target");
    } else {
      html += '<p class="phase-desc">あなたの役職に夜の行動はありません。そのままお待ちください。</p>';
      const mh = (room.mediumTonight && room.mediumTonight[myPid]);
      if (my.role === "medium" && mh) {
        html += '<p class="big-announce">🕯️ 霊媒結果：追放された ' + esc(mh.targetName) + " は" +
          (mh.result === "wolf" ? "人狼でした" : "人狼ではありませんでした") + "。</p>";
      }
    }
  }
  else if (st === "dawn") {
    const res = (room.night && room.night.result) || {};
    html = '<div class="phase-title">🌅 ' + room.day + '日目の朝</div>';
    if (res.victims && res.victims.length) {
      html += '<p class="big-announce">' + res.victims.map((v) => esc(v.name)).join("、") + " が無残な姿で発見されました…</p>";
    } else {
      html += '<p class="big-announce">昨夜の犠牲者はいませんでした。</p>';
    }
    const sr = (room.night && room.night.seerTonight && room.night.seerTonight[myPid]);
    if (sr) {
      html += '<p class="big-announce">🔮 占い結果：' + esc(sr.targetName) + " は" + (sr.result === "wolf" ? "人狼です" : "人間です") + "。</p>";
    }
  }
  else if (st === "day") {
    html = '<div class="phase-title">☀️ ' + room.day + '日目の昼</div>' +
      '<p class="phase-desc">議論の時間です（対面・通話・チャットで）。終わったら「議論を終える」を押してください。全員が押すか時間切れで投票に進みます。</p>';
    if (my && my.alive) {
      const skipped = room.daySkip && room.daySkip[myPid];
      html += '<button id="daySkipBtn" class="primary"' + (skipped ? " disabled" : "") + ">" +
        (skipped ? "議論終了に投票済み" : "議論を終える") + "</button>";
    }
  }
  else if (st === "vote") {
    html = '<div class="phase-title">🗳️ 投票</div>';
    if (!my || !my.alive) {
      html += '<p class="phase-desc">投票を見守っています。</p>';
    } else {
      const targets = aliveArr().filter((p) => p.pid !== myPid);
      const myVote = (room.votes || {})[myPid];
      html += '<p class="phase-desc">追放する相手を1人選んでください。同数の場合は誰も追放されません。</p>' +
        targetButtons(targets, myVote ? myVote.target : null, "vote-target");
    }
    const votedNames = playersArr().filter((p) => p.alive && room.votes && room.votes[p.pid]).map((p) => esc(p.name));
    html += '<div class="vote-status">投票済み：' + (votedNames.length ? votedNames.join("、") : "まだ誰も") + "</div>";
  }
  else if (st === "exile") {
    const vr = room.voteResult || {};
    html = '<div class="phase-title">⚖️ 投票結果</div>';
    if (vr.exiled) {
      html += '<p class="big-announce">' + esc(vr.exiled.name) + " が追放されました。</p>";
    } else {
      html += '<p class="big-announce">票が割れたため、今日は誰も追放されませんでした。</p>';
    }
    if (vr.counts) {
      html += '<div class="vote-status">' + Object.entries(vr.counts).map(([pid, c]) => {
        const p = room.players[pid];
        return p ? esc(p.name) + "：" + c + "票" : "";
      }).filter(Boolean).join(" ／ ") + "</div>";
    }
  }

  panel.innerHTML = html;

  const toNight = $("toNightBtn");
  if (toNight) toNight.addEventListener("click", () => hostStartNight());
  const skip = $("daySkipBtn");
  if (skip) skip.addEventListener("click", async () => {
    skip.disabled = true;
    try { await fb(subPath(roomCode, "/daySkip/" + myPid + ".json"), "PUT", true); } catch (e) {}
  });
  panel.querySelectorAll("[data-night-target]").forEach((b) => {
    b.addEventListener("click", async () => {
      const target = b.getAttribute("data-night-target");
      const type = me().role === "wolf" ? "attack" : me().role === "seer" ? "divine" : "guard";
      try {
        await fb(subPath(roomCode, "/night/actions/" + myPid + ".json"), "PUT", { type, target, ts: Date.now() });
        if (room.night) { room.night.actions = room.night.actions || {}; room.night.actions[myPid] = { type, target }; }
        renderPhasePanel();
      } catch (e) {}
    });
  });
  panel.querySelectorAll("[data-vote-target]").forEach((b) => {
    b.addEventListener("click", async () => {
      const target = b.getAttribute("data-vote-target");
      try {
        await fb(subPath(roomCode, "/votes/" + myPid + ".json"), "PUT", { target, ts: Date.now() });
        room.votes = room.votes || {};
        room.votes[myPid] = { target };
        renderPhasePanel();
      } catch (e) {}
    });
  });
}

function renderResult() {
  const w = room.winner;
  const title = w === "villager" ? "🎉 村人陣営の勝利！" : w === "wolf" ? "🐺 人狼陣営の勝利！" : w === "fox" ? "🦊 妖狐の勝利！" : "ゲーム終了";
  $("winnerBanner").textContent = title;
  $("winReason").textContent = room.winReason || "";
  $("revealList").innerHTML = playersArr().map((p) => {
    const r = p.role ? ROLES[p.role] : null;
    return '<div class="player-cell' + (p.alive ? "" : " dead") + '">' +
      "<div>" + (r ? r.icon + " " : "") + esc(p.name) + (p.bot ? "（Bot）" : "") + "</div>" +
      '<div class="st">' + (r ? r.name : "役職なし") + "・" + (p.alive ? "生存" : "死亡") + "</div></div>";
  }).join("");
  $("rematchBtn").classList.toggle("hidden", !isHost());
  $("rematchWait").classList.toggle("hidden", isHost());
  $("resultLog").innerHTML = (room.log || []).map((l) =>
    '<div class="' + esc(l.kind || "") + '">' + esc(l.text) + "</div>").join("");
}

/* ---------------- チャット ---------------- */
async function sendChat(inputId) {
  const input = $(inputId);
  const text = input.value.trim();
  if (!text || !roomCode) return;
  input.value = "";
  try {
    await fb(subPath(roomCode, "/chat.json"), "POST", { pid: myPid, name: (me() && me().name) || myName, text, ts: Date.now() });
  } catch (e) {}
}

function renderChat() {
  if (!room) return;
  const msgs = Object.values(room.chat || {}).sort((a, b) => a.ts - b.ts).slice(-60);
  const html = msgs.map((m) =>
    "<div><span class='who'>" + esc(m.name) + "</span>：" + esc(m.text) + "</div>").join("");
  ["lobbyChatLog", "chatLog"].forEach((id) => {
    const el = $(id);
    if (!el || el.offsetParent === null && id === "chatLog" && room.status === "lobby") return;
    if (el.innerHTML !== html) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      el.innerHTML = html;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
  });
}

/* ---------------- ホスト進行エンジン ---------------- */
let hostBusy = false;

async function hostPatch(patch) {
  await fb(roomPath(roomCode), "PATCH", patch);
}

function hostTick() {
  if (!room || !isHost() || hostBusy) return;
  const now = Date.now();
  const st = room.status;
  let job = null;
  if (st === "reveal" && now >= room.phaseEndsAt) job = () => hostStartNight();
  else if (st === "night") {
    hostBotsNight();
    if (nightComplete() || now >= room.phaseEndsAt) job = () => resolveNight();
  } else if (st === "dawn" && now >= room.phaseEndsAt) job = () => advanceToDay();
  else if (st === "day") {
    hostBotsDaySkip();
    if (dayComplete() || now >= room.phaseEndsAt) job = () => advanceToVote();
  } else if (st === "vote") {
    hostBotsVote();
    if (voteComplete() || now >= room.phaseEndsAt) job = () => resolveVote();
  } else if (st === "exile" && now >= room.phaseEndsAt) job = () => afterExile();
  if (!job) return;
  hostBusy = true;
  job().catch(() => {}).finally(() => { hostBusy = false; });
}

function nightComplete() {
  const actors = aliveArr().filter((p) => ["wolf", "seer", "knight"].includes(p.role));
  const actions = (room.night && room.night.actions) || {};
  return actors.every((p) => actions[p.pid]);
}
function dayComplete() {
  return aliveArr().every((p) => room.daySkip && room.daySkip[p.pid]);
}
function voteComplete() {
  return aliveArr().every((p) => room.votes && room.votes[p.pid]);
}

function checkWinner(alive) {
  const wolves = alive.filter((p) => p.role === "wolf").length;
  const foxAlive = alive.some((p) => p.role === "fox");
  const humans = alive.length - wolves;
  if (wolves === 0) return foxAlive ? "fox" : "villager";
  if (wolves >= humans) return foxAlive ? "fox" : "wolf";
  return null;
}
function winReason(winner) {
  if (winner === "villager") return "人狼は全滅した。村に平和が戻った！";
  if (winner === "wolf") return "人狼の数が人間と同数以上になった。村は人狼に支配された…";
  return "妖狐が最後まで生き残った。すべては妖狐の掌の上だった…";
}

async function hostStartGame() {
  const r = room;
  const cfg = r.config;
  const err = (m) => { $("startError").textContent = m; };
  const humans = playersArr().filter((p) => !p.bot);
  const N = cfg.botFill ? Math.max(humans.length, cfg.target) : humans.length;
  if (N < 5) { err("人数が足りません（最低5人）。Bot補充をオンにするか、友達を待ってください。"); return; }
  if (N > 12) { err("人数が多すぎます（最大12人）。"); return; }
  const comp = { ...cfg.comp };
  const used = ROLE_KEYS.reduce((s, k) => s + (comp[k] || 0), 0);
  const villagerCount = N - used;
  if ((comp.wolf || 0) < 1) { err("人狼は1人以上必要です。"); return; }
  if (villagerCount < 0) { err("役職の合計が人数を超えています。"); return; }
  err("");

  const newPlayers = {};
  humans.slice(0, N).forEach((p) => {
    newPlayers[p.pid] = { name: p.name, bot: false, alive: true, role: null, hb: p.hb || Date.now() };
  });
  const usedNames = humans.map((p) => p.name);
  let bi = 0;
  while (Object.keys(newPlayers).length < N) {
    bi++;
    const nm = BOT_NAMES.find((n) => !usedNames.includes(n)) || ("Bot" + bi);
    usedNames.push(nm);
    newPlayers["bot" + bi] = { name: nm, bot: true, alive: true, role: null, hb: Date.now() };
  }
  const deck = [];
  ROLE_KEYS.forEach((k) => { for (let i = 0; i < (comp[k] || 0); i++) deck.push(k); });
  for (let i = 0; i < villagerCount; i++) deck.push("villager");
  shuffle(deck);
  Object.keys(newPlayers).forEach((pid, i) => { newPlayers[pid].role = deck[i]; });

  const patch = {
    players: newPlayers, status: "reveal", day: 1, phaseSeq: r.phaseSeq + 1,
    phaseEndsAt: Date.now() + 30000, winner: null, winReason: "", lastExiled: null,
    night: { actions: {}, result: null, seerTonight: null }, votes: {}, daySkip: {},
    seerHistory: {}, mediumHistory: {}, mediumTonight: null, knightGuard: {}, voteResult: null,
    log: [...(r.log || []), logEntry("ゲーム開始！" + N + "人（村人" + villagerCount + "人）に役職が配られました。", "sys")],
  };
  await hostPatch(patch);
  room = { ...r, ...patch };
}

async function hostStartNight() {
  await startNight(room.status === "reveal" ? 1 : room.day + 1);
}

async function startNight(dayNum) {
  const r = room;
  let mediumTonight = null;
  if (r.lastExiled && r.players[r.lastExiled]) {
    const ex = r.players[r.lastExiled];
    const result = ex.role === "wolf" ? "wolf" : "human";
    mediumTonight = {};
    playersArr().filter((p) => p.role === "medium" && p.alive).forEach((p) => {
      mediumTonight[p.pid] = { target: r.lastExiled, targetName: ex.name, result };
    });
  }
  const patch = {
    status: "night", day: dayNum,
    night: { actions: {}, result: null, seerTonight: null },
    mediumTonight, votes: {}, daySkip: {}, lastExiled: null,
    phaseEndsAt: Date.now() + r.config.nightSec * 1000,
    phaseSeq: r.phaseSeq + 1,
    log: [...(r.log || []), logEntry("🌙 " + dayNum + "日目の夜になった。", "sys")],
  };
  await hostPatch(patch);
  room = { ...r, ...patch };
}

async function resolveNight() {
  const r = room;
  const night = r.night || {};
  const actions = night.actions || {};
  const P = r.players;

  const wolfActs = Object.entries(actions).filter(([pid, a]) => P[pid] && P[pid].role === "wolf" && P[pid].alive && a);
  let attackTarget = null;
  if (wolfActs.length) {
    const tally = {};
    wolfActs.forEach(([, a]) => {
      if (!tally[a.target]) tally[a.target] = { c: 0, ts: a.ts || 0 };
      tally[a.target].c++;
      tally[a.target].ts = Math.min(tally[a.target].ts, a.ts || Infinity);
    });
    attackTarget = Object.entries(tally).sort((x, y) => y[1].c - x[1].c || x[1].ts - y[1].ts)[0][0];
  }
  const knightAct = Object.entries(actions).find(([pid, a]) => P[pid] && P[pid].role === "knight" && P[pid].alive && a);
  const guardTarget = knightAct ? knightAct[1].target : null;
  const seerAct = Object.entries(actions).find(([pid, a]) => P[pid] && P[pid].role === "seer" && P[pid].alive && a);

  const victims = [];
  let savedAttack = false;
  if (attackTarget && P[attackTarget]) {
    if (guardTarget === attackTarget) savedAttack = true;
    else if (P[attackTarget].role === "fox") savedAttack = true;
    else victims.push(attackTarget);
  }

  let seerTonight = null;
  const seerHistory = JSON.parse(JSON.stringify(r.seerHistory || {}));
  if (seerAct) {
    const [seerPid, a] = seerAct;
    const t = P[a.target];
    if (t) {
      const result = t.role === "wolf" ? "wolf" : "human";
      seerTonight = { [seerPid]: { target: a.target, targetName: t.name, result } };
      (seerHistory[seerPid] = seerHistory[seerPid] || []).push({ day: r.day, target: a.target, targetName: t.name, result });
      if (t.role === "fox" && t.alive && !victims.includes(a.target)) victims.push(a.target); // 呪殺
    }
  }

  const knightGuard = { ...(r.knightGuard || {}) };
  if (knightAct) knightGuard[knightAct[0]] = knightAct[1].target;

  const mediumHistory = JSON.parse(JSON.stringify(r.mediumHistory || {}));
  Object.entries(r.mediumTonight || {}).forEach(([mpid, info]) => {
    (mediumHistory[mpid] = mediumHistory[mpid] || []).push({ day: r.day, targetName: info.targetName, result: info.result });
  });

  const newPlayers = JSON.parse(JSON.stringify(P));
  victims.forEach((pid) => { if (newPlayers[pid]) newPlayers[pid].alive = false; });

  const newLog = [...(r.log || [])];
  const victimObjs = victims.map((pid) => ({ pid, name: P[pid].name }));
  if (victimObjs.length) {
    newLog.push(logEntry("🌅 " + r.day + "日目の朝：" + victimObjs.map((v) => v.name).join("、") + " が無残な姿で発見された。", "death"));
  } else {
    newLog.push(logEntry("🌅 " + r.day + "日目の朝：犠牲者はいなかった。", "sys"));
  }

  const aliveAfter = Object.entries(newPlayers).map(([pid, p]) => ({ pid, ...p })).filter((p) => p.alive);
  const winner = checkWinner(aliveAfter);

  const patch = {
    players: newPlayers,
    night: { ...night, result: { victims: victimObjs, attackTarget, saved: savedAttack }, seerTonight },
    seerHistory, mediumHistory, knightGuard,
    phaseSeq: r.phaseSeq + 1,
  };
  if (winner) {
    patch.status = "finished";
    patch.winner = winner;
    patch.winReason = winReason(winner);
    patch.phaseEndsAt = 0;
    newLog.push(logEntry("🏁 " + patch.winReason, "win"));
  } else {
    patch.status = "dawn";
    patch.phaseEndsAt = Date.now() + 9000;
  }
  patch.log = newLog;
  await hostPatch(patch);
  room = { ...r, ...patch };
}

async function advanceToDay() {
  const r = room;
  const patch = {
    status: "day", daySkip: {},
    phaseEndsAt: Date.now() + r.config.discussSec * 1000,
    phaseSeq: r.phaseSeq + 1,
    log: [...(r.log || []), logEntry("☀️ " + r.day + "日目の昼になった。議論を始めてください。", "sys")],
  };
  await hostPatch(patch);
  room = { ...r, ...patch };
}

async function advanceToVote() {
  const r = room;
  const patch = {
    status: "vote", votes: {},
    phaseEndsAt: Date.now() + 60000,
    phaseSeq: r.phaseSeq + 1,
    log: [...(r.log || []), logEntry("🗳️ 投票の時間です。", "sys")],
  };
  await hostPatch(patch);
  room = { ...r, ...patch };
}

async function resolveVote() {
  const r = room;
  const P = r.players;
  const votes = r.votes || {};
  const counts = {};
  Object.values(votes).forEach((v) => { if (v && v.target && P[v.target] && P[v.target].alive) counts[v.target] = (counts[v.target] || 0) + 1; });
  let exiled = null, max = 0, tie = false;
  Object.entries(counts).forEach(([pid, c]) => {
    if (c > max) { max = c; exiled = pid; tie = false; }
    else if (c === max) tie = true;
  });
  if (tie) exiled = null;

  const newPlayers = JSON.parse(JSON.stringify(P));
  const newLog = [...(r.log || [])];
  if (exiled) {
    newPlayers[exiled].alive = false;
    newLog.push(logEntry("⚖️ 投票の結果、" + P[exiled].name + " が追放された。", "death"));
  } else {
    newLog.push(logEntry("⚖️ 投票の結果、票が割れて誰も追放されなかった。", "sys"));
  }
  const patch = {
    players: newPlayers,
    voteResult: { exiled: exiled ? { pid: exiled, name: P[exiled].name } : null, counts },
    lastExiled: exiled || null,
    status: "exile", phaseEndsAt: Date.now() + 8000,
    phaseSeq: r.phaseSeq + 1, log: newLog,
  };
  await hostPatch(patch);
  room = { ...r, ...patch };
}

async function afterExile() {
  const r = room;
  const winner = checkWinner(aliveArr());
  if (winner) {
    const patch = {
      status: "finished", winner, winReason: winReason(winner), phaseEndsAt: 0,
      phaseSeq: r.phaseSeq + 1,
      log: [...(r.log || []), logEntry("🏁 " + winReason(winner), "win")],
    };
    await hostPatch(patch);
    room = { ...r, ...patch };
  } else {
    await startNight(r.day + 1);
  }
}

async function hostRematch() {
  const r = room;
  const newPlayers = {};
  playersArr().filter((p) => !p.bot).forEach((p) => {
    newPlayers[p.pid] = { name: p.name, bot: false, alive: true, role: null, hb: p.hb || Date.now() };
  });
  const patch = {
    players: newPlayers, status: "lobby", day: 0, phaseSeq: r.phaseSeq + 1, phaseEndsAt: 0,
    winner: null, winReason: "", lastExiled: null, voteResult: null,
    night: { actions: {}, result: null, seerTonight: null }, votes: {}, daySkip: {},
    seerHistory: {}, mediumHistory: {}, mediumTonight: null, knightGuard: {},
    log: [logEntry("再戦のためロビーに戻りました。", "sys")],
  };
  await hostPatch(patch);
  room = { ...r, ...patch };
}

/* ---------------- Bot行動（ホストが実行） ---------------- */
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function hostBotsNight() {
  const key = "n" + room.phaseSeq;
  if (botActedFor[key]) return;
  botActedFor[key] = true;
  const actions = (room.night && room.night.actions) || {};
  aliveArr().filter((p) => p.bot && ["wolf", "seer", "knight"].includes(p.role)).forEach((p, i) => {
    if (actions[p.pid]) return;
    const type = p.role === "wolf" ? "attack" : p.role === "seer" ? "divine" : "guard";
    let cands = aliveArr().filter((t) => t.pid !== p.pid);
    if (p.role === "wolf") cands = cands.filter((t) => t.role !== "wolf");
    if (p.role === "seer") {
      const done = ((room.seerHistory || {})[p.pid] || []).map((h) => h.target);
      const fresh = cands.filter((t) => !done.includes(t.pid));
      if (fresh.length) cands = fresh;
    }
    if (!cands.length) return;
    const target = pickRandom(cands).pid;
    setTimeout(() => {
      fb(subPath(roomCode, "/night/actions/" + p.pid + ".json"), "PUT", { type, target, ts: Date.now() }).catch(() => {});
    }, 900 + i * 800 + Math.random() * 900);
  });
}

function hostBotsDaySkip() {
  const key = "d" + room.phaseSeq;
  if (botActedFor[key]) return;
  botActedFor[key] = true;
  aliveArr().filter((p) => p.bot).forEach((p, i) => {
    setTimeout(() => {
      fb(subPath(roomCode, "/daySkip/" + p.pid + ".json"), "PUT", true).catch(() => {});
    }, 1200 + i * 600);
  });
}

function hostBotsVote() {
  const key = "v" + room.phaseSeq;
  if (botActedFor[key]) return;
  botActedFor[key] = true;
  const votes = room.votes || {};
  aliveArr().filter((p) => p.bot).forEach((p, i) => {
    if (votes[p.pid]) return;
    let cands = aliveArr().filter((t) => t.pid !== p.pid);
    if (p.role === "wolf") {
      const nonWolf = cands.filter((t) => t.role !== "wolf");
      if (nonWolf.length) cands = nonWolf;
    }
    if (!cands.length) return;
    const target = pickRandom(cands).pid;
    setTimeout(() => {
      fb(subPath(roomCode, "/votes/" + p.pid + ".json"), "PUT", { target, ts: Date.now() }).catch(() => {});
    }, 1000 + i * 700 + Math.random() * 900);
  });
}

/* ---------------- イベント配線 ---------------- */
$("nameInput").value = myName;
$("createBtn").addEventListener("click", createRoom);
$("joinBtn").addEventListener("click", joinRoom);
$("joinCodeInput").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
$("leaveLobbyBtn").addEventListener("click", () => leaveRoom(isHost()));
$("leaveGameBtn").addEventListener("click", () => leaveRoom(false));
$("leaveResultBtn").addEventListener("click", () => leaveRoom(false));
$("rematchBtn").addEventListener("click", () => { if (isHost()) hostRematch(); });
$("startBtn").addEventListener("click", () => { if (isHost()) hostStartGame(); });
$("lobbyChatSend").addEventListener("click", () => sendChat("lobbyChatInput"));
$("chatSend").addEventListener("click", () => sendChat("chatInput"));
$("lobbyChatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat("lobbyChatInput"); });
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat("chatInput"); });

$("targetSel").addEventListener("change", async (e) => {
  if (!isHost()) return;
  const n = parseInt(e.target.value, 10);
  try {
    await fb(subPath(roomCode, "/config.json"), "PATCH", { target: n, comp: { ...COMP_TABLE[n] } });
    lobbySig = "";
  } catch (err) {}
});
$("botFillChk").addEventListener("change", async (e) => {
  if (!isHost()) return;
  try { await fb(subPath(roomCode, "/config/botFill.json"), "PUT", e.target.checked); } catch (err) {}
});
$("discussSel").addEventListener("change", async (e) => {
  if (!isHost()) return;
  try { await fb(subPath(roomCode, "/config/discussSec.json"), "PUT", parseInt(e.target.value, 10)); } catch (err) {}
});
$("nightSel").addEventListener("change", async (e) => {
  if (!isHost()) return;
  try { await fb(subPath(roomCode, "/config/nightSec.json"), "PUT", parseInt(e.target.value, 10)); } catch (err) {}
});

/* ---------------- 再入室 ---------------- */
(function init() {
  const saved = localStorage.getItem("wolf_room");
  if (saved) enterRoom(saved);
})();
