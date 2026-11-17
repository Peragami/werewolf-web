"use strict";
/* ============================================================
   役職もりもり人狼 Web版
   同期: Firebase Realtime Database（HTTPS RESTのみ・SDK不使用）
   ルームは /rooms/wolf-<CODE> に置く（リバーシと名前空間を分離）
   進行はホストの端末が管理する（サーバーレス）
   役職仕様は元リポジトリの「2D3D人狼作成指示書.docx」に準拠
   ============================================================ */

const DB_URL = "https://muze-reversi-default-rtdb.asia-southeast1.firebasedatabase.app";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_PREFIX = "wolf-";

const ROLES = {
  wolf:        { name: "人狼",     team: "wolf",     icon: "🐺", desc: "毎夜1人を襲撃する。人狼同士は互いの正体が分かる。占いでは「黒」と出る。うらめしあを襲うと自分が死ぬ。" },
  wolf2:       { name: "第二人狼", team: "wolf",     icon: "🐺", desc: "毎夜2人を襲撃できる。それ以外は人狼と同じ。占いでは「黒」と出る。" },
  madman:      { name: "狂人",     team: "wolf",     icon: "🃏", desc: "人狼側の人間。人狼の正体は知らない。占いでは「白」と出る。人狼が勝てば一緒に勝利。" },
  fanatic:     { name: "狂信者",   team: "wolf",     icon: "🙏", desc: "人狼側の人間。最初の夜から人狼が誰か分かる。占いでは「白」と出る。人狼が勝てば一緒に勝利。" },
  seer:        { name: "占い師",   team: "villager", icon: "🔮", desc: "毎夜1人を占う。人狼は「黒」、妖狐は「白」（ただし呪殺）、うらめしあは「第三陣営」、アホは「アホ」と出て対象は死ぬ。" },
  medium:      { name: "霊媒師",   team: "villager", icon: "🕯️", desc: "毎夜、すでに亡くなった人の中から1人の役職を確認できる。結果は朝に分かる。" },
  knight:      { name: "騎士",     team: "villager", icon: "🛡️", desc: "毎夜1人を護衛して襲撃から守る。自分は守れない。同じ人を続けて守ることもできる。" },
  heavyknight: { name: "重騎士",   team: "villager", icon: "⚔️", desc: "毎夜2人まで護衛できる。守った翌日はクールダウンで守れない（守った相手が黒陣営・第三陣営だと2日）。自分は守れない。" },
  sister:      { name: "シスター", team: "villager", icon: "⛪", desc: "夜に祈ると、その夜シスター以外の全員が襲撃から守られる。1マッチに2回まで。" },
  president:   { name: "大統領",   team: "villager", icon: "🎖️", desc: "2日目の投票で自分に1票も入っていなければ、3日目以降ずっと自分の投票が3倍になる。" },
  fox:         { name: "妖狐",     team: "fox",      icon: "🦊", desc: "第三陣営。襲撃では死なないが、占われると呪殺される。ゲーム終了時に生き残っていれば単独勝利。" },
  urameshia:   { name: "うらめしあ", team: "special", icon: "👻", desc: "特殊陣営。死んでいるのに発言できる存在。人狼に襲われると人狼が死に、自分は死なない。占われると消滅する。2日目の夜から、死んだ人の役職の能力を1回だけ使える。最後の2人まで残ると勝利。" },
  aho:         { name: "アホ",     team: "special",  icon: "🤪", desc: "特殊陣営。自分の役職を占い師に知られると死ぬ（占い結果は「アホ」と出る）。それ以外は村人と同じ。" },
  nottori:     { name: "のっとり", team: "special",  icon: "🎭", desc: "特殊陣営。人狼に襲われると、その人狼が死に、自分が人狼になってゲームを続ける。" },
  hinmin:      { name: "貧民",     team: "special",  icon: "🍞", desc: "特殊陣営。自分が投票した人が追放されると目覚め、それ以降の夜に人狼だけを殺せるようになる（外すと何も起きない）。" },
  executioner: { name: "処刑人",   team: "special",  icon: "🪓", desc: "特殊陣営。毎夜1人を陣営関係なく殺せる。最後に黒陣営と処刑人だけが残った場合は処刑人の勝利。" },
  villager:    { name: "村人",     team: "villager", icon: "🧑‍🌾", desc: "特殊な能力はない。議論と投票で人狼を見つけ出す。" },
};
/* 構成エディタに出す役職（村人は残りで自動） */
const ROLE_KEYS = ["wolf", "wolf2", "seer", "medium", "knight", "heavyknight", "sister", "president", "madman", "fanatic", "fox", "urameshia", "aho", "nottori", "hinmin", "executioner"];
const COMP_TABLE = {
  5:  { wolf: 1, seer: 1 },
  6:  { wolf: 1, seer: 1, knight: 1 },
  7:  { wolf: 2, seer: 1, knight: 1 },
  8:  { wolf: 2, seer: 1, medium: 1, knight: 1 },
  9:  { wolf: 2, seer: 1, medium: 1, knight: 1, madman: 1 },
  10: { wolf: 2, seer: 1, medium: 1, knight: 1, madman: 1, fox: 1 },
  11: { wolf: 2, seer: 1, medium: 1, knight: 1, heavyknight: 1, madman: 1, fox: 1 },
  12: { wolf: 3, seer: 1, medium: 1, knight: 1, heavyknight: 1, sister: 1, madman: 1, fox: 1 },
};
/* バラエティー構成：面白い役職（特殊陣営・新役職）を多めにした割り振り */
const COMP_VARIETY = {
  5:  { wolf: 1, seer: 1, executioner: 1, urameshia: 1 },
  6:  { wolf: 1, seer: 1, heavyknight: 1, executioner: 1, nottori: 1 },
  7:  { wolf: 2, seer: 1, heavyknight: 1, executioner: 1, urameshia: 1 },
  8:  { wolf: 1, wolf2: 1, seer: 1, medium: 1, sister: 1, president: 1, executioner: 1, urameshia: 1 },
  9:  { wolf: 2, seer: 1, medium: 1, heavyknight: 1, sister: 1, fanatic: 1, fox: 1, hinmin: 1 },
  10: { wolf: 2, wolf2: 1, seer: 1, medium: 1, heavyknight: 1, sister: 1, fox: 1, urameshia: 1, executioner: 1 },
  11: { wolf: 2, wolf2: 1, seer: 1, medium: 1, heavyknight: 1, sister: 1, president: 1, fanatic: 1, fox: 1, nottori: 1 },
  12: { wolf: 2, wolf2: 1, seer: 1, medium: 1, heavyknight: 1, sister: 1, president: 1, fanatic: 1, fox: 1, aho: 1, executioner: 1 },
};
const COMP_PRESETS = { normal: COMP_TABLE, variety: COMP_VARIETY };
const BOT_NAMES = ["ボブ", "アリス", "ケン", "ミサキ", "ゴロウ", "ユイ", "タロウ", "ハナ", "ジン", "リン", "ソラ", "カイ"];

const isWolfRole = (r) => r === "wolf" || r === "wolf2";
const isWolfTeam = (r) => isWolfRole(r) || r === "madman" || r === "fanatic";
const isThirdRole = (r) => ["fox", "urameshia", "aho", "nottori", "hinmin", "executioner"].includes(r);
const VILLAGER_TEAM_ROLES = ["villager", "seer", "medium", "knight", "heavyknight", "sister", "president"];
const COPYABLE_ROLES = ["wolf", "wolf2", "seer", "knight", "heavyknight", "executioner"];

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
let multiSel = { seq: -1, targets: [] }; // 第二人狼・重騎士の複数選択
let copySel = { seq: -1, source: null }; // うらめしあのコピー元選択

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const playersArr = () => Object.entries((room && room.players) || {}).map(([pid, p]) => ({ pid, ...p }));
const aliveArr = () => playersArr().filter((p) => p.alive);
const deadArr = () => playersArr().filter((p) => !p.alive);
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
function divineResultOf(role) {
  if (isWolfRole(role)) return "wolf";
  if (role === "urameshia") return "third";
  if (role === "aho") return "aho";
  return "human";
}
function divineText(result) {
  return result === "wolf" ? "人狼（黒）です" : result === "third" ? "第三陣営です" : result === "aho" ? "アホです" : "人間（白）です";
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
      v: 2, game: "werewolf", status: "lobby", host: myPid, createdAt: Date.now(),
      config: { target: 8, botFill: true, discussSec: 180, nightSec: 90, comp: { ...COMP_TABLE[8] } },
      players: { [myPid]: { name: myName, bot: false, alive: true, role: null, hb: Date.now() } },
      day: 0, phaseSeq: 0, phaseEndsAt: 0,
      log: [logEntry("ルームが作成されました。コードを友達に伝えてください。", "sys")],
      actionLog: [],
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
  if (code === "DEBUG") { await joinDebugRoom(); return; }
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

/* ---------------- デバッグルーム（コード DEBUG で入る共有テスト部屋） ---------------- */
const DEBUG_CODE = "DEBUG";
async function joinDebugRoom() {
  const code = DEBUG_CODE;
  $("homeError").textContent = "";
  $("joinBtn").disabled = true;
  try {
    const now = Date.now();
    const data = await fb(roomPath(code), "GET");
    const already = !!(data && data.players && data.players[myPid]);
    if (already && data.status !== "finished") { enterRoom(code); return; }
    const humans = data ? Object.values(data.players || {}).filter((p) => !p.bot) : [];
    const lastHb = humans.reduce((m, p) => Math.max(m, p.hb || 0), 0);
    /* 終了済み、または誰もいなくなって3分以上経った部屋は作り直す（テスターが詰まらないように） */
    const stale = !!data && (data.status === "finished" || (humans.length > 0 && now - lastHb > 180000));
    if (!data || stale) {
      const fresh = {
        v: 2, game: "werewolf", debug: true, status: "lobby", host: myPid, createdAt: now,
        config: { target: 8, botFill: true, discussSec: 180, nightSec: 90, comp: { ...COMP_TABLE[8] } },
        players: { [myPid]: { name: myName, bot: false, alive: true, role: null, wantRole: null, hb: now } },
        day: 0, phaseSeq: 0, phaseEndsAt: 0,
        log: [logEntry("🐞 デバッグルームが作成されました。ロビーで自分がなる役職の希望を設定できます。", "sys")],
        actionLog: [],
        winner: null, winReason: "",
      };
      await fb(roomPath(code), "PUT", fresh);
      enterRoom(code);
      return;
    }
    if (data.status !== "lobby") {
      $("homeError").textContent = "デバッグルームは今ゲーム中です。ホストに「ロビーに戻す」か初期化を頼んでください。";
      return;
    }
    const count = Object.keys(data.players || {}).length;
    if (count >= 12) { $("homeError").textContent = "デバッグルームは満員です（12人まで）。"; return; }
    await fb(subPath(code, "/players/" + myPid + ".json"), "PUT",
      { name: myName, bot: false, alive: true, role: null, wantRole: null, hb: now });
    enterRoom(code);
  } catch (e) {
    $("homeError").textContent = "デバッグルームへの参加に失敗しました：通信を確認して再試行してください。";
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
    if (!data) {
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
    if (me() && !me().bot) {
      fb(subPath(roomCode, "/players/" + myPid + "/hb.json"), "PUT", Date.now()).catch(() => {});
    }
    maybeTakeOverHost();
  } catch (e) { /* 一時的な通信失敗は次回ポーリングで回復 */ }
}

/* ---------------- ホスト引き継ぎ ----------------
   ホストの心拍（hb）が止まったら、残っている参加者のうち決まった1人が
   自動でホストを引き継いでゲームを続行する（ホストがタブを閉じた等） */
const HOST_STALE_MS = 25000;   // この時間心拍がなければホスト不在とみなす
const HOST_CONFIRM_MS = 6000;  // 不在を2回分のポーリングで確認してから引き継ぐ
let staleHostKey = "";
let staleHostSince = 0;
let takeoverBusy = false;

async function maybeTakeOverHost() {
  if (!room || !roomCode || takeoverBusy) return;
  const my = me();
  if (!my || my.bot || room.host === myPid) return;
  const now = Date.now();
  const hostEntry = room.players ? room.players[room.host] : null;
  const hostStale = !hostEntry || (now - (hostEntry.hb || 0) > HOST_STALE_MS);
  if (!hostStale) { staleHostKey = ""; return; }
  /* 一瞬の取得ズレで誤判定しないよう、不在が続いていることを確認する */
  const key = room.host + ":" + (hostEntry ? hostEntry.hb || 0 : "gone");
  if (key !== staleHostKey) { staleHostKey = key; staleHostSince = now; return; }
  if (now - staleHostSince < HOST_CONFIRM_MS) return;
  /* 引き継ぎ役は「心拍が新鮮な人間プレイヤーをID順に並べた先頭」で全端末一致させる */
  const candidates = Object.entries(room.players || {})
    .filter(([pid, p]) => !p.bot && pid !== room.host && now - (p.hb || 0) < HOST_STALE_MS + 5000)
    .map(([pid]) => pid).sort();
  if (!candidates.length || candidates[0] !== myPid) return;
  takeoverBusy = true;
  try {
    /* 念のため最新を取り直して、ホストが復活していないか確認する */
    const fresh = await fb(roomPath(roomCode), "GET");
    if (!fresh || fresh.host === myPid) return;
    const fh = fresh.players ? fresh.players[fresh.host] : null;
    if (fh && Date.now() - (fh.hb || 0) <= HOST_STALE_MS) return;
    await fb(roomPath(roomCode), "PATCH", { host: myPid });
    room = { ...fresh, host: myPid };
    staleHostKey = "";
    const newLog = [...(fresh.log || []), logEntry("🔄 ホストの接続が切れたため、" + my.name + " がホストを引き継ぎました。", "sys")];
    await hostPatch({ log: newLog });
    room = { ...room, log: newLog };
    render();
  } catch (e) { /* 失敗したら次のポーリングで再判定 */ }
  finally { takeoverBusy = false; }
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
    "<li><span>" + '<span class="avatar-sm">' + (p.bot ? "🤖" : "🧑") + "</span>" + esc(p.name) + (p.pid === myPid ? "（あなた）" : "") + "</span>" +
    "<span>" + (room.host === p.pid ? '<span class="tag host">ホスト</span>' : "") +
    (p.bot ? '<span class="tag">Bot</span>' : "") +
    (room.debug && p.wantRole && ROLES[p.wantRole] ? '<span class="tag">🐞希望：' + ROLES[p.wantRole].name + "</span>" : "") + "</span></li>"
  ).join("");

  const host = isHost();
  $("hostConfig").classList.toggle("hidden", !host);
  $("lobbyWait").classList.toggle("hidden", host);
  renderDebugPanel();
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

/* ---------------- 構成バランスの目安 ----------------
   人狼の実効パワーと村人側の実効パワー（人数＋情報・防御役職の補正）の比率から
   5段階で目安を出す。第三陣営・特殊役職は勝敗をかく乱するので別枠で数える */
function compBalance() {
  const cfg = room.config;
  const c = cfg.comp || {};
  const n = (k) => c[k] || 0;
  const wolves = n("wolf") + n("wolf2");
  const wolfSupport = n("madman") + n("fanatic");
  const third = n("fox") + n("urameshia") + n("aho") + n("nottori") + n("hinmin") + n("executioner");
  const assigned = ROLE_KEYS.reduce((s, k) => s + n(k), 0);
  const villagers = Math.max(0, cfg.target - assigned);
  const villTeam = villagers + n("seer") + n("medium") + n("knight") + n("heavyknight") + n("sister") + n("president");
  /* 人狼は連携と毎夜の襲撃があるぶん1人を重く数え、村人側は情報・防御役職に補正を付ける */
  const wolfPower = wolves * 2.5 + wolfSupport * 0.6;
  const villPower = villagers + n("seer") * 1.7 + n("medium") * 1.6 + n("knight") * 1.7 +
    n("heavyknight") * 1.9 + n("sister") * 1.5 + n("president") * 1.4;
  const ratio = wolfPower + villPower > 0 ? wolfPower / (wolfPower + villPower) : 0.5;
  let level, label, cls;
  if (wolves === 0) { level = -3; label = "人狼がいません"; cls = "v"; }
  else if (ratio < 0.32) { level = -2; label = "村人陣営がかなり有利"; cls = "v"; }
  else if (ratio < 0.39) { level = -1; label = "村人陣営がやや有利"; cls = "v"; }
  else if (ratio < 0.49) { level = 0; label = "互角（バランス良好）"; cls = "even"; }
  else if (ratio < 0.57) { level = 1; label = "人狼陣営がやや有利"; cls = "w"; }
  else { level = 2; label = "人狼陣営がかなり有利"; cls = "w"; }
  return { ratio, level, label, cls, wolves, wolfSupport, third, villagers, villTeam };
}

function renderCompBalance() {
  const box = $("compBalance");
  if (!box || !room) return;
  const b = compBalance();
  const pct = Math.max(2, Math.min(98, ((b.ratio - 0.15) / (0.70 - 0.15)) * 100));
  let advice = "";
  if (b.level === 2) advice = "整えるなら：人狼を減らすか、占い師・騎士を足すのがおすすめ。";
  else if (b.level === 1) advice = "少し人狼寄り。情報役職を足すと互角に近づきます。";
  else if (b.level === -2) advice = "整えるなら：人狼や狂人を足すか、情報役職を減らすのがおすすめ。";
  else if (b.level === -1) advice = "少し村人寄り。人狼を1人足すと互角に近づきます。";
  else if (b.level === 0) advice = "そのまま遊べるバランスです。";
  if (b.third >= 3) advice += " 第三・特殊役職が多めで、荒れた展開になりやすい構成です。";
  box.innerHTML =
    '<div class="bal-label ' + b.cls + '">⚖️ バランス目安：' + b.label + "</div>" +
    '<div class="bal-detail">人狼' + b.wolves + "人＋狂人系" + b.wolfSupport + "人 ／ 村人陣営" + b.villTeam + "人 ／ 第三・特殊" + b.third + "人" +
      (advice ? "<br>" + advice : "") + "</div>" +
    '<div class="balance-meter"><div class="balance-marker" style="left:' + pct.toFixed(0) + '%"></div></div>' +
    '<div class="balance-scale"><span>村人有利</span><span>互角</span><span>人狼有利</span></div>';
}

let debugSig = "";
function renderDebugPanel() {
  const panel = $("debugPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !room.debug);
  if (!room.debug) return;
  $("debugDeleteBtn").classList.toggle("hidden", !isHost());
  const my = me();
  const sig = ((my && my.wantRole) || "") + "|" + isHost();
  if (sig === debugSig) return;
  debugSig = sig;
  const sel = $("wantRoleSel");
  sel.innerHTML = ['<option value="">ランダム（構成どおり）</option>']
    .concat(["villager", ...ROLE_KEYS].map((k) =>
      '<option value="' + k + '"' + (my && my.wantRole === k ? " selected" : "") + ">" + ROLES[k].icon + " " + ROLES[k].name + "</option>"))
    .join("");
}

function compVillagers() {
  const cfg = room.config;
  const used = ROLE_KEYS.reduce((s, k) => s + (cfg.comp[k] || 0), 0);
  return cfg.target - used;
}

/* 役職構成の3ページ（白陣営／黒陣営／第三陣営・特殊役職） */
const COMP_PAGES = [
  { id: "white", label: "🤍 白陣営", teams: ["villager"] },
  { id: "black", label: "🖤 黒陣営", teams: ["wolf"] },
  { id: "third", label: "🟣 第三陣営・特殊役職", teams: ["fox", "special"] },
];
let compPage = "white";
const compPageDef = () => COMP_PAGES.find((p) => p.id === compPage) || COMP_PAGES[0];
const compKeysOfPage = (page) => ROLE_KEYS.filter((k) => page.teams.includes(ROLES[k].team));

function renderCompEditor() {
  const cfg = room.config;
  const page = compPageDef();
  const pageKeys = compKeysOfPage(page);
  const v = compVillagers();

  /* タブの選択状態と、各ページに割り当てた人数を表示する */
  document.querySelectorAll("[data-comp-page]").forEach((b) => {
    const def = COMP_PAGES.find((p) => p.id === b.getAttribute("data-comp-page"));
    if (!def) return;
    const sum = compKeysOfPage(def).reduce((s, k) => s + (cfg.comp[k] || 0), 0) + (def.id === "white" ? Math.max(0, v) : 0);
    b.textContent = def.label + "（" + sum + "）";
    b.classList.toggle("active", def.id === page.id);
  });
  const pageIdx = COMP_PAGES.indexOf(page);
  const info = $("compPageInfo");
  if (info) info.textContent = (pageIdx + 1) + " / " + COMP_PAGES.length + " ページ";
  const prev = $("compPrevBtn"), next = $("compNextBtn");
  if (prev) prev.disabled = pageIdx <= 0;
  if (next) next.disabled = pageIdx >= COMP_PAGES.length - 1;

  const cardHtml = (k) => {
    const r = ROLES[k];
    const m = RG_META[k];
    return '<div class="comp-card">' +
      '<div class="rg-bar" style="background:' + m.color + '"></div>' +
      '<div class="rg-body">' +
        '<div class="rg-head">' +
          '<span class="rg-avatar sm" style="border-color:' + m.color + '">' + r.icon + "</span>" +
          '<div><div class="rg-name">' + r.name + '</div>' +
          '<div class="rg-teamlabel">' + TEAM_LABEL[r.team] + "</div></div>" +
          '<span class="comp-ctl"><button data-comp="' + k + '" data-d="-1">−</button>' +
          '<span class="num">' + (cfg.comp[k] || 0) + "</span>" +
          '<button data-comp="' + k + '" data-d="1">＋</button></span>' +
        "</div>" +
        '<span class="rg-chip">#' + m.tag + "</span>" +
        '<p class="rg-desc">' + r.desc + "</p>" +
      "</div></div>";
  };
  /* 村人は白陣営ページの先頭に「残りで自動」の固定カードとして出す（人数は自動計算） */
  const villagerCard = page.id !== "white" ? "" : (() => {
    const r = ROLES.villager;
    const m = RG_META.villager;
    return '<div class="comp-card">' +
      '<div class="rg-bar" style="background:' + m.color + '"></div>' +
      '<div class="rg-body">' +
        '<div class="rg-head">' +
          '<span class="rg-avatar sm" style="border-color:' + m.color + '">' + r.icon + "</span>" +
          '<div><div class="rg-name">' + r.name + '</div>' +
          '<div class="rg-teamlabel">' + TEAM_LABEL[r.team] + "</div></div>" +
          '<span class="comp-ctl"><span class="num">' + Math.max(0, v) + '</span></span>' +
        "</div>" +
        '<span class="rg-chip">#残りで自動</span>' +
        '<p class="rg-desc">' + r.desc + " 人数は他の役職を引いた残りで自動調整されます。</p>" +
      "</div></div>";
  })();
  $("compEditor").innerHTML = villagerCard + pageKeys.map(cardHtml).join("");
  $("compSummary").textContent =
    "構成：" + ROLE_KEYS.map((k) => ROLES[k].name + (cfg.comp[k] || 0)).join("・") +
    "・村人" + v + "（合計" + cfg.target + "人）" +
    (v < 0 ? "　⚠ 役職が人数を超えています" : "");
  renderCompBalance();
  $("compEditor").querySelectorAll("[data-comp]").forEach((b) => {
    b.addEventListener("click", async () => {
      const k = b.getAttribute("data-comp");
      const d = parseInt(b.getAttribute("data-d"), 10);
      const next = Math.max(0, Math.min(6, (room.config.comp[k] || 0) + d));
      try {
        await fb(subPath(roomCode, "/config/comp/" + k + ".json"), "PUT", next);
        lobbySig = "";
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
  if (isWolfRole(my.role) || my.role === "fanatic") {
    const wolves = playersArr().filter((p) => isWolfRole(p.role));
    if (wolves.length) html += "<div>人狼：" + wolves.map((p) => esc(p.name) + (p.pid === myPid ? "（あなた）" : "")).join("、") + "</div>";
  }
  const sh = (room.seerHistory && room.seerHistory[myPid]) || [];
  if (my.role === "seer" && sh.length) {
    const label = { wolf: "人狼", human: "人間", third: "第三陣営", aho: "アホ" };
    html += "<div>占い履歴：" + sh.map((h) => h.day + "日目 " + esc(h.targetName) + "→" + (label[h.result] || h.result)).join(" ／ ") + "</div>";
  }
  const mh = (room.mediumHistory && room.mediumHistory[myPid]) || [];
  if (my.role === "medium" && mh.length) {
    html += "<div>霊媒履歴：" + mh.map((h) => h.day + "日目 " + esc(h.targetName) + "→" + (ROLES[h.role] ? ROLES[h.role].name : h.role)).join(" ／ ") + "</div>";
  }
  if (my.role === "president") {
    html += "<div>" + ((room.presidentBoost && room.presidentBoost[myPid]) ? "🎖️ 投票3倍が有効です" : "🎖️ 2日目の投票で自分に票が入らなければ、3日目から投票が3倍になります") + "</div>";
  }
  if (my.role === "sister") {
    const used = (room.sisterUsed && room.sisterUsed[myPid]) || 0;
    html += "<div>⛪ 祈りの残り回数：" + (2 - used) + "回</div>";
  }
  if (my.role === "heavyknight") {
    const st = (room.heavyState && room.heavyState[myPid]) || {};
    if (st.nextOkDay && room.day < st.nextOkDay) html += "<div>⚔️ クールダウン中（" + st.nextOkDay + "日目の夜から守れます）</div>";
  }
  if (my.role === "hinmin") {
    html += "<div>" + ((room.hinminActive && room.hinminActive[myPid]) ? "🍞 目覚めています：夜に人狼だけを殺せます" : "🍞 まだ目覚めていません（自分が投票した人が追放されると目覚めます）") + "</div>";
  }
  if (my.role === "urameshia") {
    const used = room.uraUsed && room.uraUsed[myPid];
    html += "<div>👻 能力コピー：" + (used ? "使用済み" : room.day >= 2 ? "未使用（今夜使えます）" : "未使用（2日目の夜から使えます）") + "</div>";
  }
  return html ? '<div class="role-history">' + html + "</div>" : "";
}

function renderGame() {
  const my = me();
  const rsig = (my ? my.role : "") + "|" + room.day + "|" + room.status + "|" +
    JSON.stringify(room.seerHistory || {}) + "|" + JSON.stringify(room.mediumHistory || {}) + "|" +
    JSON.stringify(room.presidentBoost || {}) + "|" + JSON.stringify(room.sisterUsed || {}) + "|" +
    JSON.stringify(room.heavyState || {}) + "|" + JSON.stringify(room.hinminActive || {}) + "|" + JSON.stringify(room.uraUsed || {});
  if (my && my.role && rsig !== roleSig) {
    roleSig = rsig;
    const r = ROLES[my.role];
    const teamName = r.team === "wolf" ? "人狼陣営" : r.team === "villager" ? "村人陣営" : r.team === "fox" ? "妖狐（第三陣営）" : "特殊陣営";
    $("myRoleCard").className = "card role-card " + r.team;
    $("myRoleCard").innerHTML =
      '<div class="role-name">' + r.icon + " あなたは「" + r.name + "」</div>" +
      '<div class="role-team">' + teamName + (my.alive ? "" : " ／ あなたは死亡しています") + "</div>" +
      "<p class='note'>" + r.desc + "</p>" + myHistoryHtml();
  } else if (my && !my.role) {
    $("myRoleCard").innerHTML = '<div class="phase-title">役職の配布を待っています…</div>';
  }

  renderPhasePanel();

  const dbgBar = $("debugBarGame");
  if (dbgBar) {
    dbgBar.classList.toggle("hidden", !room.debug);
    $("debugSkipBtn").classList.toggle("hidden", !isHost());
    $("debugLobbyBtn").classList.toggle("hidden", !isHost());
  }

  const iKnowWolves = me() && (isWolfRole(me().role) || me().role === "fanatic");
  $("playerGrid").innerHTML = playersArr().map((p) => {
    let st = p.alive ? "生存" : "死亡";
    if (p.pid === room.host) st += "・ホスト";
    if (p.bot) st += "・Bot";
    const roleMark = (iKnowWolves && isWolfRole(p.role) ? ' <span class="tag">🐺人狼</span>' : "") +
      (room.debug && p.role && ROLES[p.role] ? ' <span class="tag">🐞' + ROLES[p.role].name + "</span>" : "");
    const avatar = p.alive ? (p.bot ? "🤖" : "🧑") : "💀";
    return '<div class="player-cell' + (p.alive ? "" : " dead") + (p.pid === myPid ? " me" : "") + '">' +
      '<div class="pc-head"><span class="avatar">' + avatar + '</span><span class="pc-name">' +
      esc(p.name) + (p.pid === myPid ? "（あなた）" : "") + roleMark + "</span></div>" +
      '<div class="st">' + st + "</div></div>";
  }).join("");

  $("eventLog").innerHTML = (room.log || []).map((l) =>
    '<div class="' + esc(l.kind || "") + '">' + esc(l.text) + "</div>").join("");
}

function targetButtons(targets, selectedPid, dataAttr) {
  return '<div class="target-list">' + targets.map((p) =>
    '<button data-' + dataAttr + '="' + p.pid + '"' + (selectedPid === p.pid ? ' class="selected"' : "") + ">" +
    esc(p.name) + (p.bot ? "（Bot）" : "") + "</button>").join("") + "</div>";
}
function multiButtons(targets, selectedArr, dataAttr) {
  return '<div class="target-list">' + targets.map((p) =>
    '<button data-' + dataAttr + '="' + p.pid + '"' + (selectedArr.includes(p.pid) ? ' class="selected"' : "") + ">" +
    esc(p.name) + (p.bot ? "（Bot）" : "") + "</button>").join("") + "</div>";
}

function renderPhasePanel() {
  const panel = $("phasePanel");
  const my = me();
  const st = room.status;
  const night = room.night || {};
  const actions = night.actions || {};
  const myAct = actions[myPid];
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
      const targets = aliveArr().filter((p) => !isWolfRole(p.role));
      const mateActs = playersArr().filter((p) => isWolfRole(p.role) && p.alive)
        .map((p) => esc(p.name) + "：" + (actions[p.pid] ? "選択済み" : "未選択")).join(" ／ ");
      html += '<p class="phase-desc">襲撃する相手を1人選んでください（人狼全員の多数決で決まります）。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target") +
        '<div class="vote-status">人狼の選択状況：' + mateActs + "</div>";
    } else if (my.role === "wolf2") {
      if (multiSel.seq !== room.phaseSeq) multiSel = { seq: room.phaseSeq, targets: myAct && myAct.targets ? [...myAct.targets] : [] };
      const targets = aliveArr().filter((p) => !isWolfRole(p.role));
      html += '<p class="phase-desc">襲撃する相手を2人まで選んでください（タップで選択/解除）。</p>' +
        multiButtons(targets, multiSel.targets, "multi-target");
    } else if (my.role === "seer") {
      const targets = aliveArr().filter((p) => p.pid !== myPid);
      html += '<p class="phase-desc">占う相手を1人選んでください。結果は朝に分かります。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target");
    } else if (my.role === "medium") {
      const deads = deadArr();
      if (!deads.length) {
        html += '<p class="phase-desc">まだ亡くなった人はいません。今夜の霊媒はありません。</p>';
      } else {
        html += '<p class="phase-desc">役職を確認する故人を1人選んでください。結果は朝に分かります。</p>' +
          targetButtons(deads, myAct ? myAct.target : null, "night-target");
      }
    } else if (my.role === "knight") {
      const targets = aliveArr().filter((p) => p.pid !== myPid);
      html += '<p class="phase-desc">護衛する相手を1人選んでください（前夜と同じ人でもOK）。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target");
    } else if (my.role === "heavyknight") {
      const hst = (room.heavyState && room.heavyState[myPid]) || {};
      if (hst.nextOkDay && room.day < hst.nextOkDay) {
        html += '<p class="phase-desc">クールダウン中です。今夜は誰も守れません。</p>';
      } else {
        if (multiSel.seq !== room.phaseSeq) multiSel = { seq: room.phaseSeq, targets: myAct && myAct.targets ? [...myAct.targets] : [] };
        const targets = aliveArr().filter((p) => p.pid !== myPid);
        html += '<p class="phase-desc">護衛する相手を2人まで選んでください（タップで選択/解除）。守ると翌日はクールダウン、相手が黒陣営・第三陣営だと2日になります。</p>' +
          multiButtons(targets, multiSel.targets, "multi-target") +
          '<button data-heavy-none="1">今夜は守らない</button>';
      }
    } else if (my.role === "sister") {
      const used = (room.sisterUsed && room.sisterUsed[myPid]) || 0;
      const left = 2 - used;
      html += '<p class="phase-desc">祈ると今夜、あなた以外の全員が襲撃から守られます（残り' + left + '回）。</p>';
      if (left > 0) html += '<button data-sister="pray"' + (myAct && myAct.type === "pray" ? ' class="selected"' : "") + ">⛪ 祈る</button> ";
      html += '<button data-sister="none"' + (myAct && myAct.type === "none" ? ' class="selected"' : "") + ">祈らない</button>";
    } else if (my.role === "executioner") {
      const targets = aliveArr().filter((p) => p.pid !== myPid);
      html += '<p class="phase-desc">処刑する相手を1人選んでください（任意・護衛や祈りは効きません）。</p>' +
        targetButtons(targets, myAct ? myAct.target : null, "night-target") +
        '<button data-exe-skip="1">今夜は見送る</button>';
    } else if (my.role === "hinmin") {
      if (room.hinminActive && room.hinminActive[myPid]) {
        const targets = aliveArr().filter((p) => p.pid !== myPid);
        html += '<p class="phase-desc">殺す相手を1人選んでください。人狼だった場合のみ死にます（任意）。</p>' +
          targetButtons(targets, myAct ? myAct.target : null, "night-target") +
          '<button data-exe-skip="1">今夜は見送る</button>';
      } else {
        html += '<p class="phase-desc">まだ目覚めていません。自分が投票した人が追放されると目覚めます。</p>';
      }
    } else if (my.role === "urameshia") {
      const used = room.uraUsed && room.uraUsed[myPid];
      if (room.day < 2) {
        html += '<p class="phase-desc">能力コピーは2日目の夜から使えます。</p>';
      } else if (used) {
        html += '<p class="phase-desc">能力コピーは使用済みです。</p>';
      } else {
        if (copySel.seq !== room.phaseSeq) copySel = { seq: room.phaseSeq, source: myAct && myAct.type === "copy" ? myAct.source : null };
        const sources = deadArr().filter((p) => COPYABLE_ROLES.includes(p.role));
        if (!sources.length) {
          html += '<p class="phase-desc">コピーできる能力を持つ故人がまだいません。</p>';
        } else if (!copySel.source) {
          html += '<p class="phase-desc">能力をコピーする故人を選んでください（1ゲームに1回だけ）。</p>' +
            '<div class="target-list">' + sources.map((p) =>
              '<button data-copy-source="' + p.pid + '">' + esc(p.name) + "（" + ROLES[p.role].name + "）</button>").join("") + "</div>";
        } else {
          const srcRole = roleOf(copySel.source);
          const targets = aliveArr().filter((p) => p.pid !== myPid);
          html += '<p class="phase-desc">「' + (ROLES[srcRole] ? ROLES[srcRole].name : srcRole) + '」の能力をコピー中。対象を1人選んでください。</p>' +
            targetButtons(targets, myAct ? myAct.target : null, "copy-target") +
            '<button data-copy-skip="1">使わない</button>';
        }
      }
    } else {
      html += '<p class="phase-desc">あなたの役職に夜の行動はありません。そのままお待ちください。</p>';
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
    if (sr) html += '<p class="big-announce">🔮 占い結果：' + esc(sr.targetName) + " は" + divineText(sr.result) + "。</p>";
    const mr = (room.night && room.night.mediumResult && room.night.mediumResult[myPid]);
    if (mr) html += '<p class="big-announce">🕯️ 霊媒結果：' + esc(mr.targetName) + " は「" + (ROLES[mr.role] ? ROLES[mr.role].name : mr.role) + "」でした。</p>";
    const cr = (room.night && room.night.copyResult && room.night.copyResult[myPid]);
    if (cr) html += '<p class="big-announce">👻 コピー占い結果：' + esc(cr.targetName) + " は" + divineText(cr.result) + "。</p>";
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

  const putAction = async (action) => {
    try {
      await fb(subPath(roomCode, "/night/actions/" + myPid + ".json"), "PUT", action);
      if (room.night) { room.night.actions = room.night.actions || {}; room.night.actions[myPid] = action; }
      renderPhasePanel();
    } catch (e) {}
  };
  const singleType = () => {
    const r = me() && me().role;
    return r === "wolf" ? "attack" : r === "seer" ? "divine" : r === "knight" ? "guard" :
      r === "medium" ? "medium" : r === "executioner" ? "execute" : r === "hinmin" ? "hinminkill" : "none";
  };
  panel.querySelectorAll("[data-night-target]").forEach((b) => {
    b.addEventListener("click", () => putAction({ type: singleType(), target: b.getAttribute("data-night-target"), ts: Date.now() }));
  });
  panel.querySelectorAll("[data-multi-target]").forEach((b) => {
    b.addEventListener("click", () => {
      const pid = b.getAttribute("data-multi-target");
      const i = multiSel.targets.indexOf(pid);
      if (i >= 0) multiSel.targets.splice(i, 1);
      else { if (multiSel.targets.length >= 2) multiSel.targets.shift(); multiSel.targets.push(pid); }
      const type = me().role === "wolf2" ? "attack2" : "guard2";
      putAction({ type, targets: [...multiSel.targets], ts: Date.now() });
    });
  });
  panel.querySelectorAll("[data-heavy-none]").forEach((b) => {
    b.addEventListener("click", () => { multiSel.targets = []; putAction({ type: "guard2", targets: [], ts: Date.now() }); });
  });
  panel.querySelectorAll("[data-sister]").forEach((b) => {
    b.addEventListener("click", () => putAction({ type: b.getAttribute("data-sister") === "pray" ? "pray" : "none", ts: Date.now() }));
  });
  panel.querySelectorAll("[data-exe-skip]").forEach((b) => {
    b.addEventListener("click", () => putAction({ type: me().role === "executioner" ? "execute" : "hinminkill", target: null, ts: Date.now() }));
  });
  panel.querySelectorAll("[data-copy-source]").forEach((b) => {
    b.addEventListener("click", () => { copySel.source = b.getAttribute("data-copy-source"); renderPhasePanel(); });
  });
  panel.querySelectorAll("[data-copy-target]").forEach((b) => {
    b.addEventListener("click", () => putAction({ type: "copy", source: copySel.source, target: b.getAttribute("data-copy-target"), ts: Date.now() }));
  });
  panel.querySelectorAll("[data-copy-skip]").forEach((b) => {
    b.addEventListener("click", () => putAction({ type: "copy", source: null, target: null, ts: Date.now() }));
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
  const title = w === "villager" ? "🎉 村人陣営の勝利！" : w === "wolf" ? "🐺 人狼陣営の勝利！" :
    w === "fox" ? "🦊 妖狐の勝利！" : w === "urameshia" ? "👻 うらめしあの勝利！" :
    w === "executioner" ? "🪓 処刑人の勝利！" : "ゲーム終了";
  $("winnerBanner").textContent = title;
  $("winReason").textContent = room.winReason || "";
  $("revealList").innerHTML = playersArr().map((p) => {
    const r = p.role ? ROLES[p.role] : null;
    return '<div class="player-cell' + (p.alive ? "" : " dead") + '">' +
      '<div class="pc-head"><span class="avatar">' + (r ? r.icon : "❔") + '</span><span class="pc-name">' +
      esc(p.name) + (p.bot ? "（Bot）" : "") + "</span></div>" +
      '<div class="st">' + (r ? r.name : "役職なし") + "・" + (p.alive ? "生存" : "死亡") + "</div></div>";
  }).join("");
  $("rematchBtn").classList.toggle("hidden", !isHost());
  $("rematchWait").classList.toggle("hidden", isHost());
  $("resultLog").innerHTML = (room.log || []).map((l) =>
    '<div class="' + esc(l.kind || "") + '">' + esc(l.text) + "</div>").join("");
  renderActionLog();
}

function renderActionLog() {
  const elx = $("actionLogView");
  if (!elx) return;
  const entries = (room && room.actionLog) || [];
  if (!entries.length) {
    elx.innerHTML = '<div class="log-line sys">この試合の行動履歴はありません。</div>';
    return;
  }
  let html = "", lastKey = "";
  entries.forEach((e) => {
    const key = e.day + "-" + e.phase;
    if (key !== lastKey) {
      lastKey = key;
      html += '<div class="al-head">' + e.day + "日目・" + (e.phase === "night" ? "🌙 夜" : "🗳️ 投票") + "</div>";
    }
    if (e.sys) html += '<div class="al-line al-sys">▶ ' + esc(e.text) + "</div>";
    else html += '<div class="al-line"><span class="who">' + esc(e.name) + "（" + (ROLES[e.role] ? ROLES[e.role].name : e.role) + "）</span> " + esc(e.text) + "</div>";
  });
  elx.innerHTML = html;
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
    if (!el) return;
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
    // 夜の開始から8秒は全員揃っても確定しない（第二人狼の2人目選択など、人間の複数選択の猶予）。
    // 全員の行動が終わったら、残り時間を10秒まで短縮してから夜が明ける。
    const nightStartedAt = room.phaseEndsAt - (room.config.nightSec || 90) * 1000;
    const nightGraceOk = now - nightStartedAt >= 8000;
    if (now >= room.phaseEndsAt) job = () => resolveNight();
    else if (nightComplete() && nightGraceOk) job = () => capPhaseEnd(now);
  } else if (st === "dawn" && now >= room.phaseEndsAt) job = () => advanceToDay();
  else if (st === "day") {
    hostBotsDaySkip();
    if (now >= room.phaseEndsAt) job = () => advanceToVote();
    else if (dayComplete()) job = () => capPhaseEnd(now);
  } else if (st === "vote") {
    hostBotsVote();
    if (now >= room.phaseEndsAt) job = () => resolveVote();
    else if (voteComplete()) job = () => capPhaseEnd(now);
  } else if (st === "exile" && now >= room.phaseEndsAt) job = () => afterExile();
  if (!job) return;
  hostBusy = true;
  job().catch(() => {}).finally(() => { hostBusy = false; });
}

/* 全員の行動が終わったフェイズは、残り時間を10秒まで短縮する（10秒未満なら何もしない＝延ばさない） */
async function capPhaseEnd(now) {
  if (!room || room.phaseEndsAt - now <= 10000) return;
  const newEnd = now + 10000;
  room.phaseEndsAt = newEnd;
  await hostPatch({ phaseEndsAt: newEnd });
}

function heavyOnCooldown(pid) {
  const st = (room.heavyState && room.heavyState[pid]) || {};
  return !!(st.nextOkDay && room.day < st.nextOkDay);
}
function nightComplete() {
  const actions = (room.night && room.night.actions) || {};
  const actors = aliveArr().filter((p) => {
    if (isWolfRole(p.role) || p.role === "seer" || p.role === "knight") return true;
    if (p.role === "heavyknight") return !heavyOnCooldown(p.pid);
    if (p.role === "medium") return deadArr().length > 0;
    return false;
  });
  return actors.every((p) => {
    const a = actions[p.pid];
    if (!a) return false;
    if (p.role === "wolf2") return (a.targets || []).length >= 1;
    return true;
  });
}
function dayComplete() {
  return aliveArr().every((p) => room.daySkip && room.daySkip[p.pid]);
}
function voteComplete() {
  return aliveArr().every((p) => room.votes && room.votes[p.pid]);
}

function checkWinner(alive) {
  const wolves = alive.filter((p) => isWolfRole(p.role)).length;
  const foxAlive = alive.some((p) => p.role === "fox");
  const uraAlive = alive.some((p) => p.role === "urameshia");
  const exeAlive = alive.some((p) => p.role === "executioner");
  const humans = alive.length - wolves;
  if (uraAlive && alive.length <= 2) return "urameshia";
  if (wolves === 0) return foxAlive ? "fox" : "villager";
  if (wolves >= humans) {
    if (foxAlive) return "fox";
    const villagerTeamAlive = alive.some((p) => VILLAGER_TEAM_ROLES.includes(p.role));
    if (exeAlive && !villagerTeamAlive) return "executioner";
    return "wolf";
  }
  return null;
}
function winReason(winner) {
  if (winner === "villager") return "人狼は全滅した。村に平和が戻った！";
  if (winner === "wolf") return "人狼の数が人間と同数以上になった。村は人狼に支配された…";
  if (winner === "fox") return "妖狐が最後まで生き残った。すべては妖狐の掌の上だった…";
  if (winner === "urameshia") return "うらめしあが最後の2人まで残った。死してなお、この村に居座り続けた…";
  if (winner === "executioner") return "黒陣営と処刑人だけが残った。処刑人の勝利！";
  return "";
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
  if ((comp.wolf || 0) + (comp.wolf2 || 0) < 1) { err("人狼（第二人狼含む）は1人以上必要です。"); return; }
  if (villagerCount < 0) { err("役職の合計が人数を超えています。"); return; }
  err("");

  const newPlayers = {};
  humans.slice(0, N).forEach((p) => {
    newPlayers[p.pid] = { name: p.name, bot: false, alive: true, role: null, wantRole: p.wantRole || null, hb: p.hb || Date.now() };
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
  /* デバッグルームの役職希望を構成より優先する（重複OK。希望が無い人は残りのデッキから） */
  const remainingDeck = [...deck];
  const assign = {};
  Object.keys(newPlayers).forEach((pid) => {
    const src = r.players[pid];
    const want = r.debug && src && src.wantRole && ROLES[src.wantRole] ? src.wantRole : null;
    if (!want) return;
    assign[pid] = want;
    let idx = remainingDeck.indexOf(want);
    if (idx < 0) idx = remainingDeck.indexOf("villager");
    if (idx < 0) idx = remainingDeck.findIndex((x) => !isWolfRole(x));
    if (idx < 0) idx = remainingDeck.length - 1;
    if (idx >= 0) remainingDeck.splice(idx, 1);
  });
  Object.keys(newPlayers).forEach((pid) => {
    if (!assign[pid]) assign[pid] = remainingDeck.pop();
    newPlayers[pid].role = assign[pid];
  });
  if (!Object.values(assign).some((x) => isWolfRole(x))) {
    err("希望役職の結果、人狼が0人になりました。誰かが人狼を希望するか、構成に人狼を入れてください。");
    return;
  }

  const patch = {
    players: newPlayers, status: "reveal", day: 1, phaseSeq: r.phaseSeq + 1,
    phaseEndsAt: Date.now() + 30000, winner: null, winReason: "", lastExiled: null,
    night: { actions: {}, result: null, seerTonight: null, mediumResult: null, copyResult: null },
    votes: {}, daySkip: {},
    seerHistory: {}, mediumHistory: {}, knightGuard: {}, voteResult: null,
    sisterUsed: {}, heavyState: {}, hinminActive: {}, uraUsed: {}, presidentBoost: {},
    actionLog: [],
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
  const patch = {
    status: "night", day: dayNum,
    night: { actions: {}, result: null, seerTonight: null, mediumResult: null, copyResult: null },
    votes: {}, daySkip: {}, lastExiled: null,
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
  const actOf = (pid) => actions[pid];
  const actorIs = (pid, roles) => P[pid] && P[pid].alive && roles.includes(P[pid].role);

  /* ---- 人狼の襲撃（多数決。第二人狼が生存していれば上位2人まで） ---- */
  const tally = {}; // target -> {c, ts, voters:[{pid, ts}]}
  const addVote = (voter, target, ts) => {
    if (!target || !P[target]) return;
    if (!tally[target]) tally[target] = { c: 0, ts: ts || 0, voters: [] };
    tally[target].c++;
    tally[target].ts = Math.min(tally[target].ts, ts || Infinity);
    tally[target].voters.push({ pid: voter, ts: ts || 0 });
  };
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !P[pid] || !P[pid].alive) return;
    if (P[pid].role === "wolf" && a.type === "attack") addVote(pid, a.target, a.ts);
    if (P[pid].role === "urameshia" && a.type === "copy" && a.source && P[a.source] && isWolfRole(P[a.source].role)) addVote(pid, a.target, a.ts);
  });
  const sortedTargets = Object.entries(tally).sort((x, y) => y[1].c - x[1].c || x[1].ts - y[1].ts).map((e) => e[0]);
  const regularTarget = sortedTargets.length ? sortedTargets[0] : null;
  // 第二人狼は通常の襲撃とは別枠で、自分の選んだ相手（最大2人）を襲う
  const wolf2Votes = {}; // target -> [{pid, ts}]
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !P[pid] || !P[pid].alive) return;
    if (P[pid].role === "wolf2" && a.type === "attack2") {
      (a.targets || []).forEach((t) => { (wolf2Votes[t] = wolf2Votes[t] || []).push({ pid, ts: a.ts || 0 }); });
    }
  });
  const wolf2Targets = Object.entries(wolf2Votes)
    .sort((x, y) => Math.min(...x[1].map((v) => v.ts)) - Math.min(...y[1].map((v) => v.ts)))
    .map((e) => e[0]);
  const attackTargets = [...(regularTarget ? [regularTarget] : []), ...wolf2Targets.filter((t) => t !== regularTarget)];
  const votersOf = (t) => [...((tally[t] && tally[t].voters) || []), ...(wolf2Votes[t] || [])];

  /* ---- 護衛（騎士・重騎士・コピー護衛） ---- */
  const guardSet = new Set();
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !P[pid] || !P[pid].alive) return;
    if (P[pid].role === "knight" && a.type === "guard" && a.target) guardSet.add(a.target);
    if (P[pid].role === "heavyknight" && a.type === "guard2") (a.targets || []).forEach((t) => guardSet.add(t));
    if (P[pid].role === "urameshia" && a.type === "copy" && a.source && P[a.source] &&
      (P[a.source].role === "knight" || P[a.source].role === "heavyknight") && a.target) guardSet.add(a.target);
  });

  /* ---- シスターの祈り ---- */
  const sisterAct = Object.entries(actions).find(([pid, a]) => actorIs(pid, ["sister"]) && a && a.type === "pray");
  const sisterPray = !!sisterAct;
  const sisterUsed = { ...(r.sisterUsed || {}) };
  if (sisterAct) sisterUsed[sisterAct[0]] = (sisterUsed[sisterAct[0]] || 0) + 1;

  /* ---- 襲撃の解決（罠役職を含む） ---- */
  const victimSet = new Set();
  let nottoriTransform = null;
  const earliestWolfVoter = (target) => {
    const vs = votersOf(target)
      .filter((v) => P[v.pid] && isWolfRole(P[v.pid].role) && P[v.pid].alive && !victimSet.has(v.pid))
      .sort((a, b) => a.ts - b.ts);
    return vs.length ? vs[0].pid : null;
  };
  attackTargets.forEach((t) => {
    const tp = P[t];
    if (!tp || !tp.alive || victimSet.has(t)) return;
    if (sisterPray) return;               // 祈りで全員防御
    if (guardSet.has(t)) return;          // 護衛された
    if (tp.role === "fox") return;        // 妖狐は襲撃で死なない
    if (tp.role === "urameshia" || tp.role === "nottori") {
      const w = earliestWolfVoter(t);     // 罠：襲った人狼が死ぬ
      if (w) victimSet.add(w);
      if (tp.role === "nottori") nottoriTransform = t;
      return;
    }
    victimSet.add(t);
  });

  /* ---- 占い（占い師・コピー占い） ---- */
  const seerHistory = JSON.parse(JSON.stringify(r.seerHistory || {}));
  let seerTonight = null;
  let copyResult = null;
  const applyDivine = (divinerPid, targetPid, isCopy) => {
    const t = P[targetPid];
    if (!t) return;
    const result = divineResultOf(t.role);
    if (isCopy) copyResult = { [divinerPid]: { target: targetPid, targetName: t.name, result } };
    else {
      seerTonight = { [divinerPid]: { target: targetPid, targetName: t.name, result } };
      (seerHistory[divinerPid] = seerHistory[divinerPid] || []).push({ day: r.day, target: targetPid, targetName: t.name, result });
    }
    // 妖狐は呪殺、うらめしあは消滅、アホは正体がバレて死ぬ
    if (["fox", "urameshia", "aho"].includes(t.role) && t.alive) victimSet.add(targetPid);
  };
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !P[pid] || !P[pid].alive) return;
    if (P[pid].role === "seer" && a.type === "divine" && a.target) applyDivine(pid, a.target, false);
    if (P[pid].role === "urameshia" && a.type === "copy" && a.source && P[a.source] && P[a.source].role === "seer" && a.target) applyDivine(pid, a.target, true);
  });

  /* ---- 霊媒（死者の役職を確認） ---- */
  let mediumResult = null;
  const mediumHistory = JSON.parse(JSON.stringify(r.mediumHistory || {}));
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !actorIs(pid, ["medium"])) return;
    if (a.type === "medium" && a.target && P[a.target]) {
      mediumResult = { [pid]: { target: a.target, targetName: P[a.target].name, role: P[a.target].role } };
      (mediumHistory[pid] = mediumHistory[pid] || []).push({ day: r.day, target: a.target, targetName: P[a.target].name, role: P[a.target].role });
    }
  });

  /* ---- 処刑人・貧民・コピー処刑（護衛/祈り無効） ---- */
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !P[pid] || !P[pid].alive || !a.target) return;
    const t = P[a.target];
    if (!t || !t.alive) return;
    if (P[pid].role === "executioner" && a.type === "execute") victimSet.add(a.target);
    if (P[pid].role === "hinmin" && a.type === "hinminkill" && (r.hinminActive || {})[pid] && isWolfRole(t.role)) victimSet.add(a.target);
    if (P[pid].role === "urameshia" && a.type === "copy" && a.source && P[a.source] && P[a.source].role === "executioner") victimSet.add(a.target);
  });

  /* ---- 重騎士のクールダウン ---- */
  const heavyState = JSON.parse(JSON.stringify(r.heavyState || {}));
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !actorIs(pid, ["heavyknight"]) || a.type !== "guard2") return;
    const targets = a.targets || [];
    if (!targets.length) return;
    const guardedBad = targets.some((t) => P[t] && (isWolfTeam(P[t].role) || isThirdRole(P[t].role)));
    heavyState[pid] = { nextOkDay: r.day + (guardedBad ? 2 : 1) + 1 };
  });

  /* ---- うらめしあのコピー使用済み ---- */
  const uraUsed = { ...(r.uraUsed || {}) };
  Object.entries(actions).forEach(([pid, a]) => {
    if (a && P[pid] && P[pid].role === "urameshia" && a.type === "copy" && a.source) uraUsed[pid] = true;
  });

  /* ---- 騎士の護衛記録（情報用） ---- */
  const knightGuard = { ...(r.knightGuard || {}) };
  Object.entries(actions).forEach(([pid, a]) => {
    if (a && actorIs(pid, ["knight"]) && a.type === "guard") knightGuard[pid] = a.target;
  });

  /* ---- 死亡適用・のっとり変身 ---- */
  const newPlayers = JSON.parse(JSON.stringify(P));
  victimSet.forEach((pid) => { if (newPlayers[pid]) newPlayers[pid].alive = false; });
  if (nottoriTransform && newPlayers[nottoriTransform] && newPlayers[nottoriTransform].alive) {
    newPlayers[nottoriTransform].role = "wolf";
  }

  const newLog = [...(r.log || [])];
  const victimObjs = [...victimSet].map((pid) => ({ pid, name: P[pid].name }));
  if (victimObjs.length) {
    newLog.push(logEntry("🌅 " + r.day + "日目の朝：" + victimObjs.map((v) => v.name).join("、") + " が無残な姿で発見された。", "death"));
  } else {
    newLog.push(logEntry("🌅 " + r.day + "日目の朝：犠牲者はいなかった。", "sys"));
  }

  const aliveAfter = Object.entries(newPlayers).map(([pid, p]) => ({ pid, ...p })).filter((p) => p.alive);
  const winner = checkWinner(aliveAfter);

  /* ---- 行動履歴（結果画面で公開する分を記録） ---- */
  const nightEntries = [];
  const nameT = (pid) => (P[pid] ? P[pid].name : "?");
  Object.entries(actions).forEach(([pid, a]) => {
    if (!a || !P[pid] || !P[pid].alive) return;
    const role = P[pid].role;
    const E = (text) => nightEntries.push({ day: r.day, phase: "night", pid, name: P[pid].name, role, text });
    if (role === "wolf" && a.type === "attack" && a.target) E("襲撃に " + nameT(a.target) + " を選んだ");
    else if (role === "wolf2" && a.type === "attack2") E("襲撃に " + (a.targets || []).map(nameT).join("、") + " を選んだ");
    else if (role === "seer" && a.type === "divine" && a.target) E("占い：" + nameT(a.target) + " → " + divineText(divineResultOf(P[a.target].role)));
    else if (role === "medium" && a.type === "medium" && a.target) E("霊媒：" + nameT(a.target) + " は " + (ROLES[P[a.target].role] ? ROLES[P[a.target].role].name : P[a.target].role));
    else if (role === "knight" && a.type === "guard" && a.target) E("護衛：" + nameT(a.target));
    else if (role === "heavyknight" && a.type === "guard2") E((a.targets && a.targets.length) ? "護衛：" + a.targets.map(nameT).join("、") : "今夜は守らなかった");
    else if (role === "sister") E(a.type === "pray" ? "祈った（その夜は全員防御）" : "祈らなかった");
    else if (role === "executioner" && a.type === "execute") E(a.target ? "処刑：" + nameT(a.target) : "処刑を見送った");
    else if (role === "hinmin" && a.type === "hinminkill") E(a.target ? "人狼キル狙い：" + nameT(a.target) : "見送った");
    else if (role === "urameshia" && a.type === "copy") {
      if (!a.source || !a.target) E("能力コピーを見送った");
      else {
        const sr = P[a.source] ? P[a.source].role : null;
        const srn = sr && ROLES[sr] ? ROLES[sr].name : sr;
        if (sr === "seer") E("能力コピー（" + srn + "）占い：" + nameT(a.target) + " → " + divineText(divineResultOf(P[a.target].role)));
        else if (sr === "knight" || sr === "heavyknight") E("能力コピー（" + srn + "）護衛：" + nameT(a.target));
        else if (sr === "executioner") E("能力コピー（" + srn + "）処刑：" + nameT(a.target));
        else if (isWolfRole(sr)) E("能力コピー（" + srn + "）襲撃：" + nameT(a.target));
        else E("能力コピー（" + srn + "）：" + nameT(a.target));
      }
    }
  });
  nightEntries.push({ day: r.day, phase: "night", sys: true, text: victimObjs.length ? "犠牲者：" + victimObjs.map((v) => v.name).join("、") : "犠牲者はいなかった" });

  const patch = {
    players: newPlayers,
    night: { ...night, result: { victims: victimObjs, attackTargets }, seerTonight, mediumResult, copyResult },
    seerHistory, mediumHistory, knightGuard, sisterUsed, heavyState, uraUsed,
    actionLog: [...(r.actionLog || []), ...nightEntries],
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
  const voteWeight = (pid) =>
    P[pid] && P[pid].role === "president" && r.day >= 3 && (r.presidentBoost || {})[pid] ? 3 : 1;
  const counts = {};
  let rawBallots = 0;
  Object.entries(votes).forEach(([voter, v]) => {
    if (v && v.target && P[v.target] && P[v.target].alive && P[voter] && P[voter].alive) {
      counts[v.target] = (counts[v.target] || 0) + voteWeight(voter);
      rawBallots++;
    }
  });
  let exiled = null, max = 0, tie = false;
  Object.entries(counts).forEach(([pid, c]) => {
    if (c > max) { max = c; exiled = pid; tie = false; }
    else if (c === max) tie = true;
  });
  if (tie) exiled = null;

  // 大統領：2日目の投票で自分に票が入らなかったら3日目から3倍
  const presidentBoost = { ...(r.presidentBoost || {}) };
  if (r.day === 2) {
    playersArr().filter((p) => p.role === "president" && p.alive).forEach((p) => {
      const received = Object.values(votes).filter((v) => v && v.target === p.pid).length;
      presidentBoost[p.pid] = received === 0;
    });
  }
  // 貧民：自分が投票した人が追放されたら目覚める
  const hinminActive = { ...(r.hinminActive || {}) };
  if (exiled) {
    playersArr().filter((p) => p.role === "hinmin" && p.alive).forEach((p) => {
      if (votes[p.pid] && votes[p.pid].target === exiled) hinminActive[p.pid] = true;
    });
  }

  const newPlayers = JSON.parse(JSON.stringify(P));
  const newLog = [...(r.log || [])];
  if (exiled) {
    newPlayers[exiled].alive = false;
    newLog.push(logEntry("⚖️ 投票の結果、" + P[exiled].name + " が追放された。", "death"));
  } else {
    newLog.push(logEntry("⚖️ 投票の結果、票が割れて誰も追放されなかった。", "sys"));
  }
  /* ---- 行動履歴：投票も記録 ---- */
  const voteEntries = playersArr().filter((p) => p.alive).map((p) => {
    const t = votes[p.pid] && votes[p.pid].target;
    let text = t && P[t] ? "投票：" + P[t].name : "投票しなかった";
    if (t && voteWeight(p.pid) === 3) text += "（3倍）";
    return { day: r.day, phase: "vote", pid: p.pid, name: p.name, role: p.role, text };
  });
  voteEntries.push({ day: r.day, phase: "vote", sys: true, text: exiled ? "追放：" + P[exiled].name + "（" + (ROLES[P[exiled].role] ? ROLES[P[exiled].role].name : P[exiled].role) + "）" : "追放はなかった" });

  const patch = {
    players: newPlayers,
    voteResult: { exiled: exiled ? { pid: exiled, name: P[exiled].name } : null, counts },
    lastExiled: exiled || null,
    presidentBoost, hinminActive,
    actionLog: [...(r.actionLog || []), ...voteEntries],
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
    newPlayers[p.pid] = { name: p.name, bot: false, alive: true, role: null, wantRole: p.wantRole || null, hb: p.hb || Date.now() };
  });
  const patch = {
    players: newPlayers, status: "lobby", day: 0, phaseSeq: r.phaseSeq + 1, phaseEndsAt: 0,
    winner: null, winReason: "", lastExiled: null, voteResult: null,
    night: { actions: {}, result: null, seerTonight: null, mediumResult: null, copyResult: null },
    votes: {}, daySkip: {},
    seerHistory: {}, mediumHistory: {}, knightGuard: {},
    sisterUsed: {}, heavyState: {}, hinminActive: {}, uraUsed: {}, presidentBoost: {},
    actionLog: [],
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
  const put = (pid, action, delay) => setTimeout(() => {
    fb(subPath(roomCode, "/night/actions/" + pid + ".json"), "PUT", action).catch(() => {});
  }, delay);
  aliveArr().filter((p) => p.bot).forEach((p, i) => {
    if (actions[p.pid]) return;
    const d = 900 + i * 700 + Math.random() * 900;
    const others = aliveArr().filter((t) => t.pid !== p.pid);
    if (p.role === "wolf") {
      const cands = others.filter((t) => !isWolfRole(t.role));
      if (cands.length) put(p.pid, { type: "attack", target: pickRandom(cands).pid, ts: Date.now() }, d);
    } else if (p.role === "wolf2") {
      const cands = shuffle(others.filter((t) => !isWolfRole(t.role))).slice(0, 2);
      if (cands.length) put(p.pid, { type: "attack2", targets: cands.map((t) => t.pid), ts: Date.now() }, d);
    } else if (p.role === "seer") {
      const done = ((room.seerHistory || {})[p.pid] || []).map((h) => h.target);
      const fresh = others.filter((t) => !done.includes(t.pid));
      const cands = fresh.length ? fresh : others;
      if (cands.length) put(p.pid, { type: "divine", target: pickRandom(cands).pid, ts: Date.now() }, d);
    } else if (p.role === "medium") {
      const deads = deadArr();
      if (deads.length) put(p.pid, { type: "medium", target: pickRandom(deads).pid, ts: Date.now() }, d);
    } else if (p.role === "knight") {
      if (others.length) put(p.pid, { type: "guard", target: pickRandom(others).pid, ts: Date.now() }, d);
    } else if (p.role === "heavyknight") {
      if (!heavyOnCooldown(p.pid) && others.length) {
        const cands = shuffle([...others]).slice(0, 2);
        put(p.pid, { type: "guard2", targets: cands.map((t) => t.pid), ts: Date.now() }, d);
      }
    } else if (p.role === "sister") {
      const used = (room.sisterUsed && room.sisterUsed[p.pid]) || 0;
      if (used < 2 && Math.random() < 0.4) put(p.pid, { type: "pray", ts: Date.now() }, d);
    } else if (p.role === "executioner") {
      if (others.length && Math.random() < 0.7) put(p.pid, { type: "execute", target: pickRandom(others).pid, ts: Date.now() }, d);
      else put(p.pid, { type: "execute", target: null, ts: Date.now() }, d);
    } else if (p.role === "hinmin") {
      if ((room.hinminActive || {})[p.pid] && others.length) {
        put(p.pid, { type: "hinminkill", target: pickRandom(others).pid, ts: Date.now() }, d);
      }
    } else if (p.role === "urameshia") {
      const used = (room.uraUsed || {})[p.pid];
      if (room.day >= 2 && !used) {
        const sources = deadArr().filter((t) => COPYABLE_ROLES.includes(t.role));
        if (sources.length && others.length) {
          put(p.pid, { type: "copy", source: sources[0].pid, target: pickRandom(others).pid, ts: Date.now() }, d);
        }
      }
    }
  });
}

/* Botの昼の発言プラン（day -> {plans: {pid: {suspicion}}, publicBlack}）
   発言と投票を一致させるためにホストが保持する */
const botDayPlans = {};

function botChatPost(pid, name, text, delay) {
  const code = roomCode;
  setTimeout(() => {
    if (!code) return;
    fb(subPath(code, "/chat.json"), "POST", { pid, name, text, ts: Date.now() }).catch(() => {});
  }, delay);
}

/* チャットの占いCOを集める（発言順）。対抗COの判定やBotの反応に使う */
function seerClaimersFromChat() {
  const msgs = Object.values((room && room.chat) || {}).sort((a, b) => a.ts - b.ts);
  const out = [];
  const seen = new Set();
  msgs.forEach((m) => {
    if (!m.text || !m.text.includes("占い師CO") || seen.has(m.pid)) return;
    if (!room.players[m.pid]) return;
    seen.add(m.pid);
    out.push({ pid: m.pid, name: m.name, ts: m.ts });
  });
  return out;
}

/* 霊媒結果と占い報告の矛盾を探す：
   「○○は白」と言われていた人が、霊媒で「人狼だった」と出ていたら、その占いCOは偽物の疑い */
function discreditedSeersFromChat() {
  const msgs = Object.values((room && room.chat) || {}).sort((a, b) => a.ts - b.ts);
  const wolfByMedium = new Set();
  msgs.forEach((m) => {
    if (!m.text || !m.text.includes("は人狼だった")) return;
    Object.values(room.players || {}).forEach((p) => { if (m.text.includes(p.name + "は人狼だった")) wolfByMedium.add(p.name); });
  });
  if (!wolfByMedium.size) return [];
  const bad = [];
  msgs.forEach((m) => {
    if (!m.text || !m.text.includes("は占いで白だった")) return;
    Object.values(room.players || {}).forEach((p) => {
      if (m.text.includes(p.name + "は占いで白だった") && wolfByMedium.has(p.name) && !bad.includes(m.pid)) bad.push(m.pid);
    });
  });
  return bad;
}

/* チャットで誰かが「○○は黒」と言っていたら、その対象を返す（村人側Botの投票の参考） */
function claimedBlackFromChat() {
  const msgs = Object.values((room && room.chat) || {}).sort((a, b) => a.ts - b.ts);
  let found = null;
  msgs.forEach((m) => {
    if (!m.text || !m.text.includes("黒")) return;
    aliveArr().forEach((p) => {
      if (p.pid !== m.pid && m.text.includes(p.name)) found = p.pid;
    });
  });
  return found;
}

function hostBotsDaySkip() {
  const key = "d" + room.phaseSeq;
  if (botActedFor[key]) return;
  botActedFor[key] = true;
  const code = roomCode;
  const day = room.day;
  const victims = (room.night && room.night.result && room.night.result.victims) || [];
  const victimNames = victims.map((v) => v.name).join("、");
  const bots = aliveArr().filter((p) => p.bot);
  /* 情報を持つBot（占い師・霊媒師）を先に喋らせて、他のBotがその情報に反応できるようにする */
  const order = { seer: 0, medium: 1, wolf: 2, wolf2: 2, fanatic: 3, madman: 4 };
  bots.sort((a, b) => ((order[a.role] != null ? order[a.role] : 5) - (order[b.role] != null ? order[b.role] : 5)));
  const plans = {};
  let publicBlack = null; // {pid, name} 占い師BotがCOして黒を出した相手
  let publicBlackBy = null; // そのCOをした占い師Botのpid
  let counterClaim = null; // {pid, name} 対抗COしたBot（人狼・狂信者）
  const discredited = discreditedSeersFromChat().filter((pid) =>
    room.players[pid] && room.players[pid].alive); // 霊媒結果と矛盾した占いCO（偽物の疑い）
  const usedGreetings = new Set();
  const pickGreeting = (arr) => {
    const fresh = arr.filter((t) => !usedGreetings.has(t));
    const t = pickRandom(fresh.length ? fresh : arr);
    usedGreetings.add(t);
    return t;
  };

  bots.forEach((p, idx) => {
    const others = aliveArr().filter((t) => t.pid !== p.pid);
    const nameOf = (pid) => (room.players[pid] ? room.players[pid].name : "");
    const texts = [];
    let suspicion = null;

    /* --- 挨拶（＋昨夜の犠牲者への反応） --- */
    if (victims.length) {
      texts.push(pickGreeting([
        "おはよう…。" + victimNames + "がやられちゃったんだね",
        "おはよう。" + victimNames + "が犠牲になってたね…",
        "おはようございます。" + victimNames + "、かわいそうに…",
        "おはよう、みんな起きた？ " + victimNames + "がやられてた…",
        "おはよう…。昨夜は" + victimNames + "が犠牲になったみたい",
        "おはようございます。うそ、" + victimNames + "が…？",
      ]));
    } else {
      texts.push(pickGreeting([
        "おはよう！昨夜は犠牲者なしだったね",
        "おはよう。誰も死んでなくてよかった",
        "おはようございます、みんな無事だね",
        "おはよう、みんな起きた？全員無事みたい",
        "おはよう！平和な夜だったね",
      ]));
    }

    /* --- 自分の持っている情報から話す --- */
    if (p.role === "seer") {
      /* 過去に対抗COされていたら「自分が本物」と主張し直す */
      const rivals = seerClaimersFromChat().filter((c) => c.pid !== p.pid && room.players[c.pid] && room.players[c.pid].alive);
      const selfClaimed = seerClaimersFromChat().some((c) => c.pid === p.pid);
      if (selfClaimed && rivals.length && Math.random() < 0.8) {
        suspicion = rivals[rivals.length - 1].pid;
        texts.push("私は本物の占い師です。対抗で出てきた" + rivals[rivals.length - 1].name + "は偽物だと思います");
      }
      const hist = ((room.seerHistory || {})[p.pid] || []);
      const blacks = hist.filter((h) => h.result === "wolf" && room.players[h.target] && room.players[h.target].alive);
      const thirds = hist.filter((h) => h.result === "third" && room.players[h.target] && room.players[h.target].alive);
      const whites = hist.filter((h) => h.result === "human" && room.players[h.target] && room.players[h.target].alive);
      if (blacks.length) {
        const b = blacks[blacks.length - 1];
        suspicion = b.target;
        if (Math.random() < 0.85) {
          texts.push("占い師COします。" + b.targetName + "を占ったら黒でした");
          texts.push(b.targetName + "が怪しいです。今日は" + b.targetName + "に投票しようと思います");
          publicBlack = { pid: b.target, name: b.targetName };
          publicBlackBy = p.pid;
        } else {
          texts.push(b.targetName + "がすごく怪しいと思う…");
        }
      } else if (thirds.length) {
        const t = thirds[thirds.length - 1];
        suspicion = t.target;
        texts.push("占い師COします。" + t.targetName + "は第三陣営って出たよ");
      } else if (whites.length && Math.random() < 0.6) {
        const w = whites[whites.length - 1];
        texts.push(w.targetName + "は占いで白だったよ。たぶん大丈夫だと思う");
        const cands = others.filter((t) => t.pid !== w.target);
        if (cands.length && Math.random() < 0.5) {
          suspicion = pickRandom(cands).pid;
          texts.push(nameOf(suspicion) + "の方はちょっと気になるかな");
        }
      } else if (others.length) {
        suspicion = pickRandom(others).pid;
        texts.push(nameOf(suspicion) + "が少し気になる。まだ情報が少ないけど");
      }
    } else if (p.role === "medium") {
      const mh = ((room.mediumHistory || {})[p.pid] || []);
      if (mh.length) {
        const m = mh[mh.length - 1];
        const rn = ROLES[m.role] ? ROLES[m.role].name : m.role;
        if (isWolfRole(m.role)) texts.push("霊媒COします。" + m.targetName + "は人狼だったよ！");
        else texts.push("霊媒結果だよ。" + m.targetName + "は" + rn + "でした");
      }
      if (publicBlack) {
        suspicion = publicBlack.pid;
        texts.push("占いで黒が出た" + publicBlack.name + "が怪しいと思う");
      } else if (others.length && Math.random() < 0.6) {
        suspicion = pickRandom(others).pid;
        texts.push(nameOf(suspicion) + "が少し怪しい気がする");
      }
    } else if (isWolfRole(p.role)) {
      /* 自分が占いで黒を出されたら、たまに対抗COして占い師のふりをする */
      if (publicBlack && publicBlack.pid === p.pid && publicBlackBy && !counterClaim && Math.random() < 0.5) {
        counterClaim = { pid: p.pid, name: p.name };
        suspicion = publicBlackBy;
        texts.push("ちょっと待って、占い師COします。私が本物の占い師です");
        texts.push(nameOf(publicBlackBy) + "を占ったら黒でした。あっちが偽物です");
      }
      /* 人狼は村人のふりをして、人狼でない人を疑う。たまに仲間を白っぽく言う */
      const nonWolves = others.filter((t) => !isWolfRole(t.role));
      if (nonWolves.length && !(counterClaim && counterClaim.pid === p.pid)) {
        suspicion = pickRandom(nonWolves).pid;
        texts.push(pickRandom([
          nameOf(suspicion) + "がちょっと怪しい気がする",
          nameOf(suspicion) + "、なんか様子が気になるんだよね",
          "私は" + nameOf(suspicion) + "が怪しいと思うな",
        ]));
      }
      const partners = others.filter((t) => isWolfRole(t.role));
      if (partners.length && Math.random() < 0.3) {
        texts.push(pickRandom(partners).name + "は白っぽいと思うけど");
      }
    } else if (p.role === "fanatic") {
      /* 仲間の人狼が黒を出されたら、たまに対抗COしてかばう */
      if (publicBlack && publicBlackBy && isWolfRole(room.players[publicBlack.pid].role) && !counterClaim && Math.random() < 0.3) {
        counterClaim = { pid: p.pid, name: p.name };
        suspicion = publicBlackBy;
        texts.push("占い師COします。私も本物の占い師で、" + nameOf(publicBlackBy) + "を占ったら黒でしたよ");
      }
      /* 狂信者は人狼が分かるので、人狼でない人を疑い、たまに人狼をかばう */
      const nonWolves = others.filter((t) => !isWolfRole(t.role));
      if (nonWolves.length && !(counterClaim && counterClaim.pid === p.pid)) {
        suspicion = pickRandom(nonWolves).pid;
        texts.push(nameOf(suspicion) + "が怪しいと思う");
      }
      const wolves = others.filter((t) => isWolfRole(t.role));
      if (wolves.length && Math.random() < 0.4) texts.push(pickRandom(wolves).name + "は白っぽい気がする");
    } else if (p.role === "madman") {
      if (others.length) {
        suspicion = pickRandom(others).pid;
        texts.push(pickRandom([
          nameOf(suspicion) + "が怪しいんじゃない？",
          "なんとなく" + nameOf(suspicion) + "が気になるなぁ",
        ]));
      }
    } else if (isThirdRole(p.role)) {
      /* 第三・特殊陣営は目立たないように。半分くらいだけ軽く疑う */
      if (publicBlack) {
        suspicion = publicBlack.pid;
        texts.push("黒が出た" + publicBlack.name + "は怪しいね");
      } else if (others.length && Math.random() < 0.45) {
        suspicion = pickRandom(others).pid;
        texts.push(nameOf(suspicion) + "が少し気になるかも");
      }
    } else {
      /* 村人陣営（村人・騎士・重騎士・シスター・大統領）：公開情報から */
      const disc = discredited.filter((pid) => pid !== p.pid);
      if (disc.length && Math.random() < 0.8) {
        /* 霊媒結果と矛盾した占いCOは偽物の疑いが強い */
        suspicion = disc[0];
        texts.push("前に白って言ってた人の占い、霊媒結果と合ってないよね。" + nameOf(disc[0]) + "の占いは偽物じゃないかな");
      } else if (counterClaim && Math.random() < 0.55) {
        /* 対抗COが出たら、後から出てきた方を疑う */
        suspicion = counterClaim.pid;
        texts.push(pickRandom([
          "占い師が2人出たね…後から出た" + counterClaim.name + "の方が怪しい気がする",
          "対抗が出たか…。私は先に出た方を信じたいから、" + counterClaim.name + "が怪しいと思う",
        ]));
      } else if (publicBlack && Math.random() < 0.85) {
        suspicion = publicBlack.pid;
        texts.push(pickRandom([
          "占いで黒って言われた" + publicBlack.name + "が怪しいと思う",
          publicBlack.name + "が黒なら、今日は" + publicBlack.name + "に投票するつもり",
        ]));
      } else if (p.role === "knight" && !victims.length && Math.random() < 0.6) {
        texts.push("犠牲者が出なかったのは、騎士の守りが成功したのかもね");
        if (others.length && Math.random() < 0.5) {
          suspicion = pickRandom(others).pid;
          texts.push(nameOf(suspicion) + "が少し気になる");
        }
      } else if (others.length && Math.random() < 0.7) {
        suspicion = pickRandom(others).pid;
        texts.push(pickRandom([
          nameOf(suspicion) + "が少し怪しいかも。理由はまだ弱いけど",
          nameOf(suspicion) + "が気になるな。様子見してる感じがした",
          "うーん、" + nameOf(suspicion) + "が怪しい気がする",
        ]));
      }
    }

    plans[p.pid] = { suspicion };
    /* 発言をずらして流し、その後に議論終了（スキップ）を押す */
    let delay = 1000 + idx * 1700 + Math.random() * 900;
    texts.forEach((text) => {
      botChatPost(p.pid, p.name, text, delay);
      delay += 2300 + Math.random() * 1600;
    });
    const skipDelay = delay + 3000 + Math.random() * 5000;
    setTimeout(() => {
      fb(subPath(code, "/daySkip/" + p.pid + ".json"), "PUT", true).catch(() => {});
    }, skipDelay);
  });
  botDayPlans[day] = { plans, publicBlack, counterClaim };
}

function hostBotsVote() {
  const key = "v" + room.phaseSeq;
  if (botActedFor[key]) return;
  botActedFor[key] = true;
  const votes = room.votes || {};
  aliveArr().filter((p) => p.bot).forEach((p, i) => {
    if (votes[p.pid]) return;
    let cands = aliveArr().filter((t) => t.pid !== p.pid);
    if (isWolfTeam(p.role)) {
      const nonWolf = cands.filter((t) => !isWolfRole(t.role));
      if (nonWolf.length) cands = nonWolf;
    }
    if (!cands.length) return;
    /* 昼に自分が「怪しい」と言った相手に投票する（発言と投票を一致させる） */
    let target = null;
    const dayPlan = botDayPlans[room.day];
    let planned = dayPlan && dayPlan.plans[p.pid] ? dayPlan.plans[p.pid].suspicion : null;
    /* 村人側は、チャットの公開情報を精査して投票先を決める */
    if (!isWolfTeam(p.role)) {
      const disc = discreditedSeersFromChat().filter((pid) => pid !== p.pid && room.players[pid] && room.players[pid].alive);
      const claimers = seerClaimersFromChat().filter((c) => room.players[c.pid] && room.players[c.pid].alive);
      if (disc.length && Math.random() < 0.8) {
        /* 霊媒結果と矛盾した占いCOは偽物とみなす */
        planned = disc[0];
      } else if (claimers.length >= 2 && Math.random() < 0.65) {
        /* 対抗CO同士なら、後から出てきた方を疑う */
        const later = claimers[claimers.length - 1].pid;
        if (later !== p.pid) planned = later;
      } else {
        const claimed = claimedBlackFromChat();
        if (claimed && claimed !== p.pid && Math.random() < 0.75) planned = claimed;
      }
    }
    if (planned && planned !== p.pid && room.players[planned] && room.players[planned].alive &&
        !(isWolfTeam(p.role) && isWolfRole(room.players[planned].role)) && Math.random() < 0.9) {
      target = planned;
    }
    if (!target) target = pickRandom(cands).pid;
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
async function applyCompPreset(kind) {
  if (!isHost() || !room) return;
  const comp = { ...COMP_PRESETS[kind][room.config.target] };
  try {
    await fb(subPath(roomCode, "/config/comp.json"), "PUT", comp);
    room.config.comp = comp;
    lobbySig = "";
    renderCompEditor();
  } catch (e) { /* 通信失敗時はpollで戻る */ }
}
$("recommendNormalBtn").addEventListener("click", () => applyCompPreset("normal"));
$("recommendVarietyBtn").addEventListener("click", () => applyCompPreset("variety"));

/* ---------------- マイ構成（カスタムプリセットを端末に保存） ---------------- */
const CUSTOM_COMP_KEY = "wolf_custom_comps";
function loadCustomComps() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_COMP_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function saveCustomComps(obj) {
  try { localStorage.setItem(CUSTOM_COMP_KEY, JSON.stringify(obj)); } catch (e) {}
}
function refreshCompPresetSel() {
  const sel = $("compPresetSel");
  if (!sel) return;
  const names = Object.keys(loadCustomComps()).sort();
  sel.innerHTML = names.length
    ? names.map((n) => '<option value="' + esc(n) + '">💾 ' + esc(n) + "</option>").join("")
    : '<option value="">（保存した構成なし）</option>';
}
$("compSaveBtn").addEventListener("click", () => {
  if (!room || !isHost()) return;
  const name = $("compSaveName").value.trim();
  if (!name) { $("compSaveMsg").textContent = "名前を入れてから保存してね。"; return; }
  const all = loadCustomComps();
  all[name] = { target: room.config.target, comp: { ...room.config.comp } };
  saveCustomComps(all);
  refreshCompPresetSel();
  $("compPresetSel").value = name;
  $("compSaveMsg").textContent = "「" + name + "」を保存しました（目標" + room.config.target + "人）。";
});
$("compLoadBtn").addEventListener("click", async () => {
  if (!room || !isHost()) return;
  const name = $("compPresetSel").value;
  const saved = loadCustomComps()[name];
  if (!saved) { $("compSaveMsg").textContent = "先に構成を保存してください。"; return; }
  const comp = {};
  ROLE_KEYS.forEach((k) => { comp[k] = Math.max(0, Math.min(4, saved.comp && saved.comp[k] ? saved.comp[k] : 0)); });
  const target = Math.max(5, Math.min(12, saved.target || room.config.target));
  try {
    await fb(subPath(roomCode, "/config.json"), "PATCH", { comp, target });
    room.config = { ...room.config, comp, target };
    lobbySig = "";
    renderLobby();
    $("compSaveMsg").textContent = "「" + name + "」を読み込みました。";
  } catch (e) { $("compSaveMsg").textContent = "読み込みに失敗しました。通信を確認してください。"; }
});
$("compDelBtn").addEventListener("click", () => {
  const name = $("compPresetSel").value;
  if (!name) return;
  const all = loadCustomComps();
  delete all[name];
  saveCustomComps(all);
  refreshCompPresetSel();
  $("compSaveMsg").textContent = "「" + name + "」を削除しました。";
});
refreshCompPresetSel();
document.querySelectorAll("[data-comp-page]").forEach((b) => {
  b.addEventListener("click", () => {
    if (!room || !isHost()) return;
    compPage = b.getAttribute("data-comp-page");
    renderCompEditor();
  });
});
$("compPrevBtn").addEventListener("click", () => {
  if (!room || !isHost()) return;
  const i = COMP_PAGES.indexOf(compPageDef());
  if (i > 0) { compPage = COMP_PAGES[i - 1].id; renderCompEditor(); }
});
$("compNextBtn").addEventListener("click", () => {
  if (!room || !isHost()) return;
  const i = COMP_PAGES.indexOf(compPageDef());
  if (i < COMP_PAGES.length - 1) { compPage = COMP_PAGES[i + 1].id; renderCompEditor(); }
});
$("wantRoleSel").addEventListener("change", async (e) => {
  if (!room || !room.debug || !me()) return;
  const v = e.target.value || null;
  try {
    await fb(subPath(roomCode, "/players/" + myPid + "/wantRole.json"), "PUT", v);
    if (room.players[myPid]) room.players[myPid].wantRole = v;
    debugSig = "";
    renderLobby();
  } catch (err) { /* 通信失敗時はpollで戻る */ }
});
$("debugDeleteBtn").addEventListener("click", () => { if (room && room.debug && isHost()) leaveRoom(true); });
$("debugSkipBtn").addEventListener("click", async () => {
  if (!room || !room.debug || !isHost()) return;
  room.phaseEndsAt = Date.now();
  try { await hostPatch({ phaseEndsAt: Date.now() }); } catch (e) {}
});
$("debugLobbyBtn").addEventListener("click", () => { if (room && room.debug && isHost()) hostRematch(); });
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

/* ---------------- 役職カード表示用メタ（役職構成エディタ） ---------------- */
const RG_META = {
  villager:    { color: "#8ecae6", tag: "能力なし" },
  seer:        { color: "#6ee7a0", tag: "占い" },
  medium:      { color: "#c4b5fd", tag: "霊媒" },
  knight:      { color: "#5b8cff", tag: "護衛" },
  heavyknight: { color: "#2dd4bf", tag: "2人護衛" },
  sister:      { color: "#ffd166", tag: "全体防御" },
  president:   { color: "#f5c542", tag: "投票3倍" },
  wolf:        { color: "#e5484d", tag: "襲撃" },
  wolf2:       { color: "#ff7a59", tag: "2人襲撃" },
  madman:      { color: "#e93d82", tag: "人狼側" },
  fanatic:     { color: "#f76b15", tag: "人狼が分かる" },
  fox:         { color: "#ffb703", tag: "単独勝利" },
  urameshia:   { color: "#9d6bff", tag: "能力コピー" },
  aho:         { color: "#f472b6", tag: "バレたら死" },
  nottori:     { color: "#a78bfa", tag: "人狼化" },
  hinmin:      { color: "#d4a373", tag: "人狼キル" },
  executioner: { color: "#94a3b8", tag: "処刑" },
};
const TEAM_LABEL = { villager: "村人陣営", wolf: "人狼陣営", fox: "第三陣営", special: "特殊陣営" };

/* ---------------- 再入室 ---------------- */
(function init() {
  const saved = localStorage.getItem("wolf_room");
  if (saved) enterRoom(saved);
})();
