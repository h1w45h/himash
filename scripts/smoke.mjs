// Сквозная проверка работающего сервера: вход по нику → комната с ботом → партия в шахматы через Socket.io.
// Запуск: API=http://localhost:3000 node scripts/smoke.mjs   (сервер без ключей Clerk)
import { io } from 'socket.io-client';

const API = process.env.API ?? 'http://localhost:3000';
const nick = `smoke${Math.floor(Math.random() * 1e6)}`;
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer dev:${nick}` };
const call = async (path, method = 'GET', body) => {
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return r.json();
};
const ok = (m) => console.log('✓', m);

const me = await call('/users/me');
ok(`вход по нику: ${me.username}`);
const games = await call('/games');
ok(`каталог: ${games.length} игр`);

const room = await call('/rooms', 'POST', { gameSlug: 'chess', maxPlayers: 2, visibility: 'PRIVATE', isRated: false });
await call(`/rooms/${room.code}/bots`, 'POST', { level: 'EASY' });
const started = await call(`/rooms/${room.code}/start`, 'POST');
const matchId = started.matchId ?? started.id ?? started.match?.id;
ok(`комната ${room.code}, партия ${matchId}`);

const socket = io(`${API}/game`, { transports: ['websocket'], auth: { token: `dev:${nick}` } });
await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
const emit = (ev, data) => new Promise((res) => socket.emit(ev, data, res));
let ack = await emit('match:resync', { matchId });
if (!ack.ok) throw new Error('resync: ' + JSON.stringify(ack));
let snap = ack.data;
ok(`снимок партии: место ${snap.seat}, ходов допустимо ${snap.legal.length}`);

let plies = 0;
while (snap.status === 'IN_PROGRESS' && plies < 3) {
  if (!snap.currentSeats.includes(snap.seat)) {
    snap = await new Promise((res) => socket.once('match:update', res));
    continue;
  }
  const move = snap.legal[0];
  ack = await emit('match:action', { matchId, expectedVersion: snap.version, action: move });
  if (!ack.ok) throw new Error('ход отклонён: ' + JSON.stringify(ack));
  plies++;
  ok(`мой ход ${plies} принят, версия ${ack.data?.version ?? '?'}`);
  snap = await new Promise((res) => socket.once('match:update', res)).then((u) => (u.seat === undefined ? snap : u));
}
await emit('match:resign', { matchId });
socket.close();
ok('сквозной сценарий пройден');
