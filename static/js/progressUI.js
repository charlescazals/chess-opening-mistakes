// Progress UI - shows progress during fetching and analysis

let progressOverlay = null;
let progressStartTime = null;

function createProgressOverlay() {
    if (progressOverlay) return progressOverlay;

    progressOverlay = document.createElement('div');
    progressOverlay.className = 'progress-overlay';
    progressOverlay.innerHTML = `
        <div class="progress-modal">
            <div class="progress-header">
                <h2 id="progress-title">Processing...</h2>
                <button class="progress-cancel-btn" onclick="handleProgressCancel()">Cancel</button>
            </div>
            <div class="progress-body">
                <div class="progress-message" id="progress-message">Initializing...</div>
                <div class="progress-bar-container">
                    <div class="progress-bar" id="progress-bar"></div>
                </div>
                <div class="progress-stats">
                    <span id="progress-count">0 / 0</span>
                    <span id="progress-eta"></span>
                </div>
                <div class="progress-details" id="progress-details"></div>
            </div>
        </div>
    `;

    document.body.appendChild(progressOverlay);
    return progressOverlay;
}

function showProgress(title) {
    createProgressOverlay();
    progressStartTime = Date.now();

    document.getElementById('progress-title').textContent = title;
    document.getElementById('progress-message').textContent = 'Initializing...';
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-count').textContent = '';
    document.getElementById('progress-eta').textContent = '';
    document.getElementById('progress-details').textContent = '';

    progressOverlay.classList.add('visible');
}

function hideProgress() {
    if (progressOverlay) {
        progressOverlay.classList.remove('visible');
    }
    progressStartTime = null;
}

function updateProgress(data) {
    if (!progressOverlay) return;

    if (data.message) {
        document.getElementById('progress-message').textContent = data.message;
    }

    if (data.current !== undefined && data.total !== undefined) {
        const percent = Math.round((data.current / data.total) * 100);
        document.getElementById('progress-bar').style.width = percent + '%';
        document.getElementById('progress-count').textContent = `${data.current} / ${data.total}`;

        // Calculate ETA
        if (progressStartTime && data.current > 0) {
            const elapsed = Date.now() - progressStartTime;
            const avgTimePerItem = elapsed / data.current;
            const remaining = data.total - data.current;
            const etaMs = avgTimePerItem * remaining;

            if (etaMs > 0) {
                const etaSeconds = Math.round(etaMs / 1000);
                if (etaSeconds < 60) {
                    document.getElementById('progress-eta').textContent = `~${etaSeconds}s remaining`;
                } else {
                    const minutes = Math.floor(etaSeconds / 60);
                    const seconds = etaSeconds % 60;
                    document.getElementById('progress-eta').textContent = `~${minutes}m ${seconds}s remaining`;
                }
            }
        }
    }

    if (data.gamesFound !== undefined) {
        document.getElementById('progress-details').textContent = `Games found: ${data.gamesFound}`;
    }

    if (data.mistakes !== undefined) {
        document.getElementById('progress-details').textContent = `Mistakes found: ${data.mistakes}`;
    }

    if (data.stage === 'complete') {
        document.getElementById('progress-bar').style.width = '100%';
        document.getElementById('progress-eta').textContent = 'Done!';
    }
}

function handleProgressCancel() {
    // Cancel any ongoing operations
    if (typeof cancelFetch === 'function') {
        cancelFetch();
    }
    if (typeof cancelAnalysis === 'function') {
        cancelAnalysis();
    }
    hideProgress();
    // Small delay to allow final save to complete, then refresh to display results
    setTimeout(() => location.reload(), 200);
}

async function runWithProgress(title, asyncFn) {
    showProgress(title);
    try {
        const result = await asyncFn(updateProgress);
        return result;
    } finally {
        // Small delay to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
        hideProgress();
    }
}
