// Elementos DOM
const screens = {
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen')
};

const settings = {
    players: document.getElementById('players'),
    speed: document.getElementById('speed'),
    sensitivity: document.getElementById('sensitivity'),
    cameraFacing: document.getElementById('camera-facing')
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
    round: document.getElementById('round-number')
};

const messageHUD = {
    container: document.getElementById('game-message'),
    title: document.getElementById('message-title'),
    subtitle: document.getElementById('message-subtitle'),
    btnRestart: document.getElementById('btn-restart')
};

// Estado do Jogo
let gameState = {
    isPlaying: false,
    isGreenLight: false, // true = andando, false = parado
    loopTimer: null,
    animationFrameId: null,
    players: [], // status de cada jogador (eliminated: bool)
    config: {
        numPlayers: 2,
        speed: 1.0,
        sensitivity: 50, // 1 a 100
        cameraFacing: 'user',
        phrase: 'Batatinha frita um, dois, três!'
    },
    round: 1,
    referenceFrames: [] // array guardando os imageData de referencia de cada zona
};

const RESOLUTION_DOWNSCALE = 4; // Para performance ao analisar pixels (analisa pixels saltando)

// Câmera e Canvas
async function initCamera() {
    try {
        // Tenta configurações altíssimas (para pegar maximum pixels) + facingMode
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: gameState.config.cameraFacing,
                width: { ideal: 1920 }, // Melhor qualidade disponível
                height: { ideal: 1080 }
            }
        });
        video.srcObject = stream;
        setupError.classList.add('hidden');

        // Espelhar o vídeo só se for frontal
        if (gameState.config.cameraFacing === 'user') {
            video.classList.add('mirrored');
        } else {
            video.classList.remove('mirrored');
        }

        return new Promise(resolve => {
            video.onloadedmetadata = () => {
                video.play();
                // Definir tamanho exato do canvas para preservar a alta resolução
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve(true);
            };
        });
    } catch (err) {
        console.error("Erro ao acessar a câmera: ", err);
        // Exibindo o erro REAL do navegador para ajudar a debugar
        setupError.innerHTML = `Erro ao acessar a webcam: <b>${err.name}</b><br>Tente novamente.`;
        setupError.classList.remove('hidden');
        return false;
    }
}

function stopCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
}

// UI Setup
btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;

    // Carregar config ANTES de iniciar a câmera (para o facingMode funcionar)
    gameState.config.numPlayers = parseInt(settings.players.value);
    gameState.config.speed = parseFloat(settings.speed.value);
    gameState.config.sensitivity = parseInt(settings.sensitivity.value);
    gameState.config.cameraFacing = settings.cameraFacing.value;

    // Pegar o select 'phrase' (vamos buscá-lo do DOM direto aqui pois não estava no objeto settings inicial)
    const phraseSelect = document.getElementById('phrase');
    if (phraseSelect) {
        gameState.config.phrase = phraseSelect.value;
    }

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
    stopGame();
    screens.game.classList.remove('active');
    screens.game.classList.add('hidden');
    screens.setup.classList.remove('hidden');
    screens.setup.classList.add('active');
});

messageHUD.btnRestart.addEventListener('click', () => { // Bug fix: btnRestart -> messageHUD.btnRestart
    startGame();
});

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

// Lógica de Renderização e Análise
function gameLoop() {
    if (!gameState.isPlaying) return;

    // Desenhar video no canvas (espelhando se for frontal)
    ctx.save();
    if (gameState.config.cameraFacing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Se é Luz Vermelha, analisar movimento de quem ainda está vivo
    if (!gameState.isGreenLight) {
        checkMovement();
    }

    gameState.animationFrameId = requestAnimationFrame(gameLoop);
}

function checkMovement() {
    const numPlayers = gameState.config.numPlayers;
    const zoneWidth = Math.floor(canvas.width / numPlayers);
    const height = canvas.height;

    const thresholdPercentage = ((100 - gameState.config.sensitivity) / 100) * 0.15 + 0.01;
    const colorTolerance = 40;

    let anyoneEliminatedThisFrame = false;

    for (let i = 0; i < numPlayers; i++) {
        if (gameState.players[i].eliminated) continue;

        const xStart = i * zoneWidth;
        const currentFrame = ctx.getImageData(xStart, 0, zoneWidth, height);
        const refFrame = gameState.referenceFrames[i];

        if (!refFrame) continue; // Pula se ainda não pegou referencia do momento "estátua"

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
            anyoneEliminatedThisFrame = true;
        }
    }

    // Se alguém foi eliminado, verificar se jogo acabou para evitar chamadas duplicadas
    if (anyoneEliminatedThisFrame && gameState.players.every(p => p.eliminated)) {
        pauseCycle();
        showGameOverHUD("TODOS ELIMINADOS!", "Que pena. As estátuas caíram!");
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
    if (gameState.players[index].eliminated) return; // Segurança
    gameState.players[index].eliminated = true;
    const zoneElement = document.getElementById(`zone-${index}`);
    zoneElement.classList.add('eliminated');
}

// Ciclo do Jogo e Narração
function startGame() {
    window.speechSynthesis.cancel();
    clearTimeout(gameState.loopTimer);
    messageHUD.container.classList.add('hidden');
    messageHUD.btnRestart.classList.add('hidden');

    Array.from(document.querySelectorAll('.zone')).forEach(z => {
        z.classList.remove('eliminated');
        z.classList.remove('safe');
    });

    gameState.players.forEach(p => p.eliminated = false);
    gameState.round = 1;
    gameState.isPlaying = true;

    if (!gameState.animationFrameId) {
        gameState.animationFrameId = requestAnimationFrame(gameLoop);
    }

    startRound();
}

function stopGame() {
    gameState.isPlaying = false;
    window.speechSynthesis.cancel();
    clearTimeout(gameState.loopTimer);
    if (gameState.animationFrameId) {
        cancelAnimationFrame(gameState.animationFrameId);
        gameState.animationFrameId = null;
    }
    stopCamera();
}

function pauseCycle() {
    window.speechSynthesis.cancel();
    clearTimeout(gameState.loopTimer);
}

function startRound() {
    if (!gameState.isPlaying) return;
    statusElements.round.innerText = gameState.round;
    triggerGreenLight();
}

function triggerGreenLight() {
    gameState.isGreenLight = true;
    gameState.referenceFrames = gameState.referenceFrames.map(() => null); // Limpar frames de referência

    // UI Update
    statusElements.greenLight.classList.add('active');
    statusElements.redLight.classList.remove('active');
    statusElements.text.textContent = "PODE ANDAR!";
    statusElements.text.className = "status-text green";

    // Narração usando a frase escolhida nas configurações
    const msg = new SpeechSynthesisUtterance(gameState.config.phrase);
    msg.lang = 'pt-BR';
    msg.rate = gameState.config.speed;

    msg.onend = () => {
        if (gameState.isPlaying) {
            triggerRedLight();
        }
    };

    msg.onerror = () => {
        if (gameState.isPlaying) {
            gameState.loopTimer = setTimeout(triggerRedLight, 3000 / gameState.config.speed);
        }
    };

    gameState.loopTimer = setTimeout(() => {
        if (gameState.isPlaying) window.speechSynthesis.speak(msg);
    }, 1000);
}

function triggerRedLight() {
    gameState.isGreenLight = false;

    // UI Update
    statusElements.redLight.classList.add('active');
    statusElements.greenLight.classList.remove('active');
    statusElements.text.textContent = "ESTÁTUA!";
    statusElements.text.className = "status-text red";

    // Bug Fix: Dar um tempo minúsculo (400ms) de "Reação Humana" antes de guardar a posição de referência
    // Isso evita o erro de "Todos Eliminados" logo no milissegundo em que a voz para de falar.
    gameState.loopTimer = setTimeout(() => {
        if (gameState.isPlaying && !gameState.isGreenLight) {
            captureReferenceFrames(); // Só começa a fiscalizar a partir daqui

            // Duração do tempo parado aleatório entre 2 a 4 segundos
            const waitTime = Math.random() * 2000 + 2000;

            gameState.loopTimer = setTimeout(() => {
                if (gameState.isPlaying) {
                    // Verificar vitória
                    if (gameState.round >= 5) {
                        const survivors = gameState.players.reduce((acc, curr, index) => !curr.eliminated ? acc.concat(index + 1) : acc, []);
                        if (survivors.length > 0) {
                            showGameOverHUD("GANHARAM!", `Sobrevivente(s): Jogador(es) ${survivors.join(', ')}`);
                            pauseCycle();
                            return;
                        }
                    }
                    if (!gameState.players.every(p => p.eliminated)) {
                        gameState.round++;
                        triggerGreenLight();
                    }
                }
            }, waitTime);
        }
    }, 400); // 400ms delay para os jogadores pararem o corpo por completo.
}

function showGameOverHUD(title, subtitle) {
    messageHUD.title.innerText = title;
    messageHUD.subtitle.innerText = subtitle;
    messageHUD.container.classList.remove('hidden');
    messageHUD.btnRestart.classList.remove('hidden');
}
