// Sensora · Etapa 2 — Control BLE del módulo A
// Firmware compatible: AutoOff_Speaker_A_BLE_v3.ino
const SERVICE_UUID = '7c6a1000-46f2-4c6a-9a5b-1e1f050a0001';
const WRITE_UUID = '7c6a1001-46f2-4c6a-9a5b-1e1f050a0001';
const READ_UUID = '7c6a1002-46f2-4c6a-9a5b-1e1f050a0001';
const $ = id => document.getElementById(id);
let device, server, writeChar, readChar, timer = null;
let busy = false, reading = false, currentMode = null;
let connectionAttempt = 0;
const connectButton = $('btnConnect');
const modeNames = { STOPPED: 'En espera', COUNTDOWN: 'Temporizador activo', WAITING: 'Esperando confirmación', TIMED_OUT: 'Tiempo agotado' };
const connected = () => !!(device?.gatt?.connected && writeChar && readChar);
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
}
function hint(message) { $('connectionHint').textContent = message; }
function updateButtons() {
  const ready = connected() && !busy;
  connectButton.disabled = busy;
  $('btnStart').disabled = !ready || !['STOPPED', 'TIMED_OUT'].includes(currentMode);
  $('btnStop').disabled = !ready || !['COUNTDOWN', 'WAITING'].includes(currentMode);
  $('btnConfirm').disabled = !ready || currentMode !== 'WAITING';
}
function resetDisplay(message = 'Selecciona el ESP32 para conectarte.') {
  currentMode = null;
  $('connectionStatus').textContent = 'Desconectado';
  $('connectionBadge').classList.remove('is-connected');
  connectButton.textContent = 'Conectar Bluetooth';
  $('modeBadge').textContent = 'SIN CONEXIÓN';
  $('systemStatus').textContent = 'Esperando conexión';
  $('remainingTime').textContent = '--:--:--';
  $('relayStatus').textContent = 'Sin datos';
  $('alertStatus').textContent = 'Sin datos';
  $('modeStatus').textContent = 'Sin datos';
  hint(message);
  updateButtons();
}
function stopPolling() { if (timer !== null) clearInterval(timer); timer = null; }
function onDisconnect() {
  connectionAttempt++;
  stopPolling(); server = null; writeChar = null; readChar = null;
  resetDisplay('Bluetooth desconectado. Puedes volver a conectar.');
}
function renderStatus(data) {
  if (!data || !Object.hasOwn(modeNames, data.mode) || !Number.isFinite(data.remaining)) throw new Error('Estado BLE inesperado');
  currentMode = data.mode;
  $('modeBadge').textContent = data.mode;
  $('modeStatus').textContent = data.mode;
  $('systemStatus').textContent = modeNames[data.mode];
  $('remainingTime').textContent = formatTime(data.remaining);
  // Estos estados se infieren de la lógica de la versión v3 del firmware,
  // NO se miden directamente con sensores ni vienen en el JSON.
  $('relayStatus').textContent = ['COUNTDOWN', 'WAITING'].includes(data.mode) ? 'Activo (estimado)' : 'Apagado (estimado)';
  $('alertStatus').textContent = data.mode === 'WAITING' ? 'Solicitando confirmación' : 'Inactiva (estimada)';
  updateButtons();
}
async function readStatus() {
  if (!connected() || reading || busy) return;
  reading = true;
  try {
    const value = await readChar.readValue();
    const data = JSON.parse(new TextDecoder().decode(value));
    renderStatus(data);
  } catch (err) {
    if (connected()) hint('Error leyendo estado BLE: ' + err.message);
  } finally { reading = false; }
}
async function connect() {
  if (device?.gatt?.connected) { device.gatt.disconnect(); return; }
  if (!navigator.bluetooth) { hint('Web Bluetooth requiere Chrome compatible y localhost o HTTPS.'); return; }
  const attempt = ++connectionAttempt;
  busy = true; updateButtons();
  try {
    // Si ya autorizaste este ESP32, reconecta sin pedir que vuelva a aparecer en el selector.
    if (!device) {
      hint('Selecciona AutoOff_A en la ventana Bluetooth…');
      device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE_UUID] });
    } else hint('Reconectando al ESP32 autorizado…');
    device.removeEventListener('gattserverdisconnected', onDisconnect);
    device.addEventListener('gattserverdisconnected', onDisconnect);
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    writeChar = await service.getCharacteristic(WRITE_UUID);
    readChar = await service.getCharacteristic(READ_UUID);
    if (attempt !== connectionAttempt) return;
    $('deviceName').textContent = device.name || 'ESP32 (sin nombre)';
    $('connectionStatus').textContent = 'Conectado';
    $('connectionBadge').classList.add('is-connected');
    connectButton.textContent = 'Desconectar Bluetooth';
    hint('Conectado al ESP32. Estado leído desde el dispositivo.');
  } catch (err) {
    server = null; writeChar = null; readChar = null;
    if (device?.gatt?.connected) device.gatt.disconnect();
    // Conservamos el dispositivo autorizado para reintentar sin abrir el selector.
    resetDisplay(err.name === 'NotFoundError' ? 'No se seleccionó un dispositivo.' : 'No se pudo conectar: ' + err.message + '. Vuelve a pulsar Conectar para reintentar.');
  } finally {
    busy = false; updateButtons();
  }
  if (connected()) {
    await readStatus();
    stopPolling(); timer = setInterval(readStatus, 1000);
  }
}
function getField(id, label, max) {
  const input = $(id);
  const raw = input.value.trim() || '0';
  input.value = raw;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n > max) {
    input.focus(); throw new Error(`${label}: introduce un número entero entre 0 y ${max}.`);
  }
  return n;
}
function getDurations() {
  const usage = getField('usageHours', 'Horas de uso', 24) * 3600 + getField('usageMinutes', 'Minutos de uso', 59) * 60 + getField('usageSeconds', 'Segundos de uso', 59);
  const confirmation = getField('confirmMinutes', 'Minutos de confirmación', 59) * 60 + getField('confirmSeconds', 'Segundos de confirmación', 59);
  // Límites del firmware v3: uso 1–86400 s, confirmación 1–3600 s.
  if (usage < 1 || usage > 86400) throw new Error('El tiempo de uso debe ser mayor que cero y máximo 24 horas.');
  if (confirmation < 1 || confirmation > 3600) throw new Error('El tiempo de confirmación debe ser mayor que cero y máximo 60 minutos.');
  return { usage, confirmation };
}
async function sendCommand(command) {
  if (!connected() || busy) return;
  busy = true; updateButtons();
  try {
    const bytes = new TextEncoder().encode(command);
    if (writeChar.properties.write) await writeChar.writeValueWithResponse(bytes);
    else if (writeChar.properties.writeWithoutResponse) await writeChar.writeValueWithoutResponse(bytes);
    else throw new Error('La característica BLE no permite escritura.');
    hint(`Comando enviado: ${command}. Verificando estado…`);
  } catch (err) { hint('No se pudo enviar el comando: ' + err.message); }
  finally { busy = false; updateButtons(); }
  // El ESP32 procesa los comandos en su loop, no necesariamente en el instante de escribir.
  setTimeout(readStatus, 350);
}
connectButton.addEventListener('click', connect);
$('btnStart').addEventListener('click', () => {
  try { if (!['STOPPED', 'TIMED_OUT'].includes(currentMode)) return; const { usage, confirmation } = getDurations(); sendCommand(`START:${usage}:${confirmation}`); }
  catch (err) { hint(err.message); }
});
$('btnStop').addEventListener('click', () => { if (['COUNTDOWN', 'WAITING'].includes(currentMode)) sendCommand('STOP'); });
$('btnConfirm').addEventListener('click', () => { if (currentMode === 'WAITING') sendCommand('CONFIRM'); });

// Los campos vacíos equivalen a cero; se permiten únicamente dos dígitos.
for (const input of document.querySelectorAll('.fields input')) {
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 2); });
  input.addEventListener('blur', () => {
    const value = Number(input.value || 0);
    input.value = String(Math.min(value, Number(input.dataset.max || 59)));
  });
}

resetDisplay();
if (!navigator.bluetooth) hint('Abre esta página en Chrome compatible mediante localhost o HTTPS para usar Web Bluetooth.');
