// ===========================
// BATATINHA FRITA 1, 2, 3
// Script completo - v3.0
// ===========================

// --- Elementos DOM ---
const screens = {
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen')
};

const btnStart = document.getElementById('btn-start');
const btnBack = document.getElementById('btn-back');
const setupError = document.getElementById('setup-error');

const video = document.getElementById('webcam');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const playerZonesContainer = document.getElementById('player-zones');

const statusElements = {
    greenLight: document.querySelector('.green-light'),
    redLight: document.querySelector('.red-light'),
    text: document.getElementById('status-text'),
    round: document.getElementById('round-number'),
    roundTotal: document.getElementById('round-total')
};

const messageHUD = {
    container: document.getElementById('game-message'),
    title: document.getElementById('message-title'),
    subtitle: document.getElementById('message-subtitle'),
    btnRestart: document.getElementById('btn-restart')
};

// --- Estado do Jogo ---
let gameState = {
    phase: 'idle', // 'idle' | 'green' | 'red-grace' | 'red-detecting' | 'gameover'
    timers: [],    // Array de TODOS os timeouts ativos (para limpar tudo de uma vez)
    animationFrameId: null,
    players: [],
    config: {
        numPlayers: 2,
        speed: 1.0,
        sensitivity: 50,
        cameraFacing: 'user',
        phrase: 'Batatinha frita um, dois, três!',
        totalRounds: 5
    },
    round: 1,
    referenceFrames: []
};

const RESOLUTION_DOWNSCALE = 4;
const GRACE_PERIOD_MS = 600; // Tempo de graça após "ESTÁTUA" antes de detectar

// --- Utilitários de Timer ---
// Todos os timeouts passam por aqui para serem rastreados e cancelados corretamente
function safeTimeout(fn, ms) {
    const id = setTimeout(() => {
        // Remove este timer do array quando executar
        gameState.timers = gameState.timers.filter(t => t !== id);
        fn();
    }, ms);
    gameState.timers.push(id);
    return id;
}

function clearAllTimers() {
    gameState.timers.forEach(id => clearTimeout(id));
    gameState.timers = [];
    window.speechSynthesis.cancel();
}

// --- Câmera ---
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: gameState.config.cameraFacing,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        video.srcObject = stream;
        setupError.classList.add('hidden');

        if (gameState.config.cameraFacing === 'user') {
            video.classList.add('mirrored');
        } else {
            video.classList.remove('mirrored');
        }

        return new Promise(resolve => {
            video.onloadedmetadata = () => {
                video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve(true);
            };
        });
    } catch (err) {
        console.error("Erro ao acessar a câmera: ", err);
        setupError.innerHTML = `Erro: <b>${err.name}</b> - ${err.message}`;
        setupError.classList.remove('hidden');
        return false;
    }
}

function stopCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}

// --- Loop de Renderização (NUNCA para enquanto na tela do jogo) ---
function renderLoop() {
    // Sempre desenha o vídeo no canvas, independente do estado do jogo
    ctx.save();
    if (gameState.config.cameraFacing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Só verifica movimento durante a fase de detecção ativa
    if (gameState.phase === 'red-detecting') {
        checkMovement();
    }

    gameState.animationFrameId = requestAnimationFrame(renderLoop);
}

function startRenderLoop() {
    if (!gameState.animationFrameId) {
        gameState.animationFrameId = requestAnimationFrame(renderLoop);
    }
}

function stopRenderLoop() {
    if (gameState.animationFrameId) {
        cancelAnimationFrame(gameState.animationFrameId);
        gameState.animationFrameId = null;
    }
}

// --- Detecção de Movimento ---
function checkMovement() {
    const numPlayers = gameState.config.numPlayers;
    const zoneWidth = Math.floor(canvas.width / numPlayers);
    const height = canvas.height;

    const thresholdPercentage = ((100 - gameState.config.sensitivity) / 100) * 0.15 + 0.01;
    const colorTolerance = 40;

    for (let i = 0; i < numPlayers; i++) {
        if (gameState.players[i].eliminated) continue;

        const xStart = i * zoneWidth;
        const currentFrame = ctx.getImageData(xStart, 0, zoneWidth, height);
        const refFrame = gameState.referenceFrames[i];

        if (!refFrame) continue;

        let changedPixels = 0;
        let totalSampledPixels = 0;

        for (let py = 0; py < height; py += RESOLUTION_DOWNSCALE) {
            for (let px = 0; px < zoneWidth; px += RESOLUTION_DOWNSCALE) {
                const index = (py * zoneWidth + px) * 4;

                const rDiff = Math.abs(currentFrame.data[index] - refFrame.data[index]);
                const gDiff = Math.abs(currentFrame.data[index + 1] - refFrame.data[index + 1]);
                const bDiff = Math.abs(currentFrame.data[index + 2] - refFrame.data[index + 2]);

                if (rDiff > colorTolerance || gDiff > colorTolerance || bDiff > colorTolerance) {
                    changedPixels++;
                }
                totalSampledPixels++;
            }
        }

        const changeRatio = changedPixels / totalSampledPixels;
        if (changeRatio > thresholdPercentage) {
            eliminatePlayer(i);
        }
    }

    // Se todos foram eliminados
    if (gameState.players.every(p => p.eliminated)) {
        gameState.phase = 'gameover'; // Para a detecção imediatamente
        clearAllTimers();
        showGameOverHUD("TODOS ELIMINADOS!", "Que pena! Ninguém sobreviveu.");
    }
}

function captureReferenceFrames() {
    const numPlayers = gameState.config.numPlayers;
    const zoneWidth = Math.floor(canvas.width / numPlayers);
    const height = canvas.height;

    for (let i = 0; i < numPlayers; i++) {
        if (!gameState.players[i].eliminated) {
            const xStart = i * zoneWidth;
            gameState.referenceFrames[i] = ctx.getImageData(xStart, 0, zoneWidth, height);
        }
    }
}

function eliminatePlayer(index) {
    if (gameState.players[index].eliminated) return;
    gameState.players[index].eliminated = true;
    const zoneElement = document.getElementById(`zone-${index}`);
    if (zoneElement) zoneElement.classList.add('eliminated');
}

// --- Zonas dos Jogadores ---
function setupZones() {
    playerZonesContainer.innerHTML = '';
    gameState.players = [];
    gameState.referenceFrames = [];

    for (let i = 0; i < gameState.config.numPlayers; i++) {
        const zone = document.createElement('div');
        zone.className = 'zone';
        zone.id = `zone-${i}`;

        const label = document.createElement('div');
        label.className = 'zone-label';
        label.innerText = `P${i + 1}`;
        zone.appendChild(label);

        playerZonesContainer.appendChild(zone);
        gameState.players.push({ eliminated: false });
        gameState.referenceFrames.push(null);
    }
}

// --- Ciclo Principal do Jogo ---
function startGame() {
    // Limpar tudo de ciclos anteriores
    clearAllTimers();

    // Esconder HUD de game over
    messageHUD.container.classList.add('hidden');
    messageHUD.btnRestart.classList.add('hidden');

    // Resetar zonas visuais
    Array.from(document.querySelectorAll('.zone')).forEach(z => {
        z.classList.remove('eliminated');
        z.classList.remove('safe');
    });

    // Resetar estado
    gameState.players.forEach(p => p.eliminated = false);
    gameState.referenceFrames = gameState.referenceFrames.map(() => null);
    gameState.round = 1;
    gameState.phase = 'idle';

    // Atualizar display de rodadas
    statusElements.round.innerText = gameState.round;
    statusElements.roundTotal.innerText = gameState.config.totalRounds;

    // Garantir que o render loop está rodando (câmera viva!)
    startRenderLoop();

    // Iniciar primeira rodada
    triggerGreenLight();
}

function triggerGreenLight() {
    gameState.phase = 'green';
    gameState.referenceFrames = gameState.referenceFrames.map(() => null);

    // Atualizar display de rodada
    statusElements.round.innerText = gameState.round;

    // UI Update
    statusElements.greenLight.classList.add('active');
    statusElements.redLight.classList.remove('active');
    statusElements.text.textContent = "PODE ANDAR!";
    statusElements.text.className = "status-text green";

    // Narração
    const msg = new SpeechSynthesisUtterance(gameState.config.phrase);
    msg.lang = 'pt-BR';
    msg.rate = gameState.config.speed;

    msg.onend = () => {
        if (gameState.phase === 'green') {
            triggerRedLight();
        }
    };

    msg.onerror = () => {
        if (gameState.phase === 'green') {
            safeTimeout(triggerRedLight, 3000 / gameState.config.speed);
        }
    };

    // Pequeno delay antes de falar
    safeTimeout(() => {
        if (gameState.phase === 'green') {
            window.speechSynthesis.speak(msg);
        }
    }, 800);
}

function triggerRedLight() {
    gameState.phase = 'red-grace'; // Fase de graça: jogadores estão parando o corpo

    // UI Update
    statusElements.redLight.classList.add('active');
    statusElements.greenLight.classList.remove('active');
    statusElements.text.textContent = "ESTÁTUA!";
    statusElements.text.className = "status-text red";

    // Após o período de graça, capturar referência e começar a detectar
    safeTimeout(() => {
        if (gameState.phase !== 'red-grace') return; // Saiu da fase (ex: restart)

        captureReferenceFrames();
        gameState.phase = 'red-detecting'; // AGORA sim, estamos fiscalizando!

        // Duração de fiscalização: 2 a 4 segundos aleatório
        const detectDuration = Math.random() * 2000 + 2000;

        safeTimeout(() => {
            if (gameState.phase !== 'red-detecting') return;

            // Rodada terminou sem eliminar todos
            if (gameState.round >= gameState.config.totalRounds) {
                // Jogo acabou! Quem sobreviveu, ganhou
                const survivors = gameState.players
                    .reduce((acc, curr, index) => !curr.eliminated ? acc.concat(index + 1) : acc, []);

                gameState.phase = 'gameover';
                clearAllTimers();

                if (survivors.length > 0) {
                    showGameOverHUD("PARABÉNS! 🏆", `Vencedor(es): Jogador(es) ${survivors.join(', ')}`);
                } else {
                    showGameOverHUD("TODOS ELIMINADOS!", "Ninguém sobreviveu até o final.");
                }
                return;
            }

            // Ainda tem rodadas: próxima rodada
            gameState.round++;
            triggerGreenLight();

        }, detectDuration);
    }, GRACE_PERIOD_MS);
}

function showGameOverHUD(title, subtitle) {
    messageHUD.title.innerText = title;
    messageHUD.subtitle.innerText = subtitle;
    messageHUD.container.classList.remove('hidden');
    messageHUD.btnRestart.classList.remove('hidden');
}

// --- Event Listeners ---
btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;

    // Carregar todas as configurações
    gameState.config.numPlayers = parseInt(document.getElementById('players').value);
    gameState.config.speed = parseFloat(document.getElementById('speed').value);
    gameState.config.sensitivity = parseInt(document.getElementById('sensitivity').value);
    gameState.config.cameraFacing = document.getElementById('camera-facing').value;
    gameState.config.totalRounds = parseInt(document.getElementById('total-rounds').value);

    const phraseSelect = document.getElementById('phrase');
    if (phraseSelect) gameState.config.phrase = phraseSelect.value;

    const hasCamera = await initCamera();
    if (hasCamera) {
        setupZones();
        startGame();

        screens.setup.classList.remove('active');
        screens.setup.classList.add('hidden');
        screens.game.classList.remove('hidden');
        screens.game.classList.add('active');
    }
    btnStart.disabled = false;
});

btnBack.addEventListener('click', () => {
    clearAllTimers();
    gameState.phase = 'idle';
    stopRenderLoop();
    stopCamera();

    screens.game.classList.remove('active');
    screens.game.classList.add('hidden');
    screens.setup.classList.remove('hidden');
    screens.setup.classList.add('active');
});

messageHUD.btnRestart.addEventListener('click', () => {
    // Simplesmente reiniciar o jogo - o render loop continua vivo!
    startGame();
});
