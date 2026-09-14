// State
const state = {
    photoId: null,
    title: '',
    src: '',
    description: '',
    history: []
};

// Get photo ID from filename (e.g., photo1.html -> 1)
const getPhotoId = () => {
    const path = window.location.pathname;
    const filename = path.split('/').pop();
    const match = filename.match(/^photo(\d+)\.html$/);
    return match ? parseInt(match[1]) : 1;
};

// Format timestamp for history display
function formatTimestamp(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '';
    }
}

// Render current description
function renderDescription(text) {
    const descEl = document.getElementById('photo-description');
    if (descEl) {
        descEl.textContent = text || 'No description available.';
    }
}

// Render history list inside accordion
function renderHistory(history) {
    const historyListEl = document.getElementById('history-list');
    const historyCountEl = document.getElementById('history-count');
    
    const count = Array.isArray(history) ? history.length : 0;
    if (historyCountEl) {
        historyCountEl.textContent = count;
    }

    if (!historyListEl) return;

    if (!count) {
        historyListEl.innerHTML = '<p class="history-empty" id="history-empty-msg">No previous descriptions yet.</p>';
        return;
    }

    historyListEl.innerHTML = '';

    history.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'history-item';
        card.id = `history-item-${item.id || index}`;

        const header = document.createElement('div');
        header.className = 'history-item-header';

        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'history-item-tags';

        if (item.styleLabel) {
            const tag = document.createElement('span');
            tag.className = 'history-tag';
            tag.textContent = item.styleLabel;
            tagsDiv.appendChild(tag);
        }

        if (item.customText) {
            const customSpan = document.createElement('span');
            customSpan.className = 'history-custom-focus';
            customSpan.textContent = `Nudge: "${item.customText}"`;
            tagsDiv.appendChild(customSpan);
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'history-time';
        timeSpan.textContent = formatTimestamp(item.timestamp);

        header.appendChild(tagsDiv);
        header.appendChild(timeSpan);

        const textPara = document.createElement('p');
        textPara.className = 'history-item-text';
        textPara.textContent = item.description;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'history-item-actions';

        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn-restore';
        restoreBtn.id = `btn-restore-${item.id || index}`;
        restoreBtn.textContent = 'Restore This Version';
        restoreBtn.dataset.historyId = item.id;
        restoreBtn.addEventListener('click', () => handleRestore(item.id, restoreBtn));

        actionsDiv.appendChild(restoreBtn);

        card.appendChild(header);
        card.appendChild(textPara);
        card.appendChild(actionsDiv);

        historyListEl.appendChild(card);
    });
}

// Show status message with type (success, error, loading)
function showStatus(message, type = '') {
    const statusEl = document.getElementById('regenerate-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;

    if (type === 'success') {
        setTimeout(() => {
            if (statusEl.textContent === message) {
                statusEl.textContent = '';
                statusEl.className = 'status-message';
            }
        }, 5000);
    }
}

// Fetch initial description & history
async function loadPhotoDescription(title, imageSrc) {
    try {
        const response = await fetch('/api/describe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title, imageSrc })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Service error (${response.status})`);
        }

        state.description = data.description || '';
        state.history = Array.isArray(data.history) ? data.history : [];

        renderDescription(state.description);
        renderHistory(state.history);
    } catch (error) {
        console.error('Error loading AI description:', error);
        renderDescription('Could not load AI description. Please check your Groq API key or try again.');
        showStatus(error.message, 'error');
    }
}

// Handle Regenerate Form Submit
async function handleRegenerate(e) {
    e.preventDefault();

    const styleSelect = document.getElementById('nudge-style');
    const textInput = document.getElementById('nudge-text');
    const submitBtn = document.getElementById('regenerate-btn');

    const style = styleSelect ? styleSelect.value : 'balanced';
    const customText = textInput ? textInput.value.trim() : '';

    if (customText.length > 100) {
        showStatus('Direction cannot exceed 100 characters.', 'error');
        return;
    }

    if (!state.src) {
        showStatus('Image source not loaded yet. Please wait.', 'error');
        return;
    }

    // Set loading UI
    if (submitBtn) {
        submitBtn.disabled = true;
        const btnText = submitBtn.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Regenerating...';
    }
    showStatus('Analyzing image and generating new description...', 'loading');

    try {
        const response = await fetch('/api/regenerate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: state.title,
                imageSrc: state.src,
                style,
                customText
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Failed to regenerate description.');
        }

        state.description = data.description;
        state.history = Array.isArray(data.history) ? data.history : [];

        renderDescription(state.description);
        renderHistory(state.history);

        // Reset input & counter
        if (textInput) {
            textInput.value = '';
            const counter = document.getElementById('char-counter');
            if (counter) counter.textContent = '0 / 100';
        }

        showStatus('Description updated and saved!', 'success');
    } catch (error) {
        console.error('Error regenerating description:', error);
        showStatus(error.message || 'Could not regenerate description.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            const btnText = submitBtn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'Regenerate Description';
        }
    }
}

// Handle Restore Click
async function handleRestore(historyId, buttonElement) {
    if (!historyId || !state.src) return;

    const originalText = buttonElement ? buttonElement.textContent : '';
    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Restoring...';
    }

    showStatus('Restoring previous description...', 'loading');

    try {
        const response = await fetch('/api/restore', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                imageSrc: state.src,
                historyId
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Failed to restore description.');
        }

        state.description = data.description;
        state.history = Array.isArray(data.history) ? data.history : [];

        renderDescription(state.description);
        renderHistory(state.history);

        showStatus('Description successfully restored.', 'success');
    } catch (error) {
        console.error('Error restoring description:', error);
        showStatus(error.message || 'Could not restore description.', 'error');
    } finally {
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.textContent = originalText;
        }
    }
}

// Setup Event Listeners
function setupControls() {
    const form = document.getElementById('regenerate-form');
    if (form) {
        form.addEventListener('submit', handleRegenerate);
    }

    const textInput = document.getElementById('nudge-text');
    const charCounter = document.getElementById('char-counter');
    if (textInput && charCounter) {
        textInput.addEventListener('input', () => {
            charCounter.textContent = `${textInput.value.length} / 100`;
            if (textInput.value.length >= 100) {
                charCounter.style.color = '#dc2626';
            } else {
                charCounter.style.color = '#777';
            }
        });
    }
}

// Load photo data and initial description
document.addEventListener('DOMContentLoaded', async () => {
    setupControls();

    const photoId = getPhotoId();
    state.photoId = photoId;

    let title = 'Photo ' + photoId;
    let src = '';

    try {
        const response = await fetch('photos.json');
        if (response.ok) {
            const data = await response.json();
            const photo = data.photos.find(p => p.id === photoId);
            if (photo) {
                title = photo.title || title;
                src = photo.src || src;
            }
        }
    } catch (error) {
        console.error('Error loading photo data:', error);
    }

    state.title = title;
    state.src = src;

    const titleEl = document.getElementById('photo-title');
    const imageEl = document.getElementById('photo-image');

    if (titleEl) titleEl.textContent = title;
    if (imageEl) {
        imageEl.src = src;
        imageEl.alt = title;
    }

    // Fetch initial AI description and history
    await loadPhotoDescription(title, src);
});
