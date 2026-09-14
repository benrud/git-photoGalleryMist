const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');

if (typeof process.loadEnvFile === 'function' && existsSync(path.resolve(__dirname, '.env'))) {
    try {
        process.loadEnvFile(path.resolve(__dirname, '.env'));
    } catch (e) {
        console.warn('Could not load .env file:', e.message);
    }
}

const PORT = 3000;
const HOST = '0.0.0.0';
const PUBLIC_ROOT = path.resolve(__dirname);
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
const DESCRIPTIONS_FILE = path.resolve(PUBLIC_ROOT, 'descriptions.json');

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
};

const STYLE_INSTRUCTIONS = {
    'balanced': 'Standard, balanced sports commentary in 2-3 clear, engaging sentences.',
    'short': 'Short and punchy. Limit the description to 1-2 concise, high-impact sentences.',
    'detailed': 'Detailed and in-depth. Provide a comprehensive 3-4 sentence breakdown of player actions, form, equipment, and field setting.',
    'humorous': 'Playful and humorous. Include witty, lighthearted, and amusing sports commentary while still accurately describing what is visible.',
    'serious': 'Analytical and serious. Frame the description with professional sports journalism rigor, focusing on tactical execution and athletic discipline.',
    'embellished': 'Dramatic and embellished. Use vivid, cinematic, and epic storytelling prose with evocative sports metaphors.',
    'descriptive': 'Purely descriptive and objective. Stick strictly to plain visual facts, jersey colors, player positions, and observable physical elements without fluff.',
};

const STYLE_LABELS = {
    'balanced': 'Standard & Balanced',
    'short': 'Short & Punchy',
    'detailed': 'Detailed & Long',
    'humorous': 'Funny & Playful',
    'serious': 'Analytical & Serious',
    'embellished': 'Dramatic & Embellished',
    'descriptive': 'Purely Descriptive',
};

function sendJson(response, status, body) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
}

// Load saved descriptions from file
function loadDescriptions() {
    if (existsSync(DESCRIPTIONS_FILE)) {
        try {
            const data = readFileSync(DESCRIPTIONS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Error loading descriptions:', e.message);
        }
    }
    return {};
}

// Save descriptions to file
function saveDescriptions(descriptions) {
    try {
        writeFileSync(DESCRIPTIONS_FILE, JSON.stringify(descriptions, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving descriptions:', e.message);
    }
}

function getImageRecord(descriptions, imageKey) {
    if (descriptions[imageKey] && typeof descriptions[imageKey] === 'object' && typeof descriptions[imageKey].current === 'string') {
        if (!Array.isArray(descriptions[imageKey].history)) {
            descriptions[imageKey].history = [];
        }
        return descriptions[imageKey];
    }

    // Resolve legacy entries
    let current = '';
    const history = [];

    if (descriptions[`vision-v5:${imageKey}`]) {
        current = descriptions[`vision-v5:${imageKey}`];
    } else if (typeof descriptions[imageKey] === 'string') {
        current = descriptions[imageKey];
    }

    // Collect historical versions from legacy keys if present
    ['vision-v4', 'vision-v3', 'vision-v1'].forEach((prefix, idx) => {
        const legacyKey = `${prefix}:${imageKey}`;
        if (descriptions[legacyKey] && descriptions[legacyKey] !== current) {
            history.push({
                id: `legacy_${prefix}_${imageKey.replace(/[^a-zA-Z0-9]/g, '')}`,
                description: descriptions[legacyKey],
                timestamp: new Date(Date.now() - (idx + 1) * 86400000).toISOString(),
                styleLabel: `Archived Draft (${prefix.toUpperCase()})`,
                customText: ''
            });
        }
    });

    if (descriptions[imageKey] && typeof descriptions[imageKey] === 'string' && descriptions[imageKey] !== current) {
        history.push({
            id: `legacy_flat_${imageKey.replace(/[^a-zA-Z0-9]/g, '')}`,
            description: descriptions[imageKey],
            timestamp: new Date(Date.now() - 172800000).toISOString(),
            styleLabel: 'Original Description',
            customText: ''
        });
    }

    const record = {
        current,
        history,
        lastStyle: 'balanced',
        lastStyleLabel: 'Standard & Balanced',
        lastCustomText: ''
    };
    descriptions[imageKey] = record;
    return record;
}

async function readJsonBody(request) {
    let body = '';

    for await (const chunk of request) {
        body += chunk;
        if (body.length > 32_768) {
            throw new Error('Request body is too large.');
        }
    }

    try {
        return JSON.parse(body || '{}');
    } catch {
        throw new Error('Request body must be valid JSON.');
    }
}

async function readAndEncodeImage(imageSrc) {
    const imagesRoot = path.resolve(PUBLIC_ROOT, 'images');
    const imagePath = path.resolve(PUBLIC_ROOT, imageSrc.replace(/^\/+/, ''));

    if (!imagePath.startsWith(`${imagesRoot}${path.sep}`)) {
        const err = new Error('The image source must be inside the images directory.');
        err.status = 400;
        throw err;
    }

    const ext = path.extname(imagePath).toLowerCase();
    if (ext === '.svg') {
        const err = new Error('Placeholder SVG vector images cannot be analyzed by AI vision models. Please use a photograph (JPEG, PNG, or WebP).');
        err.status = 400;
        throw err;
    }

    const imageMimeTypes = {
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
    };
    const mimeType = imageMimeTypes[ext];
    if (!mimeType) {
        const err = new Error('The image must be a JPEG, PNG, or WebP photo.');
        err.status = 400;
        throw err;
    }

    let imageBuffer;
    try {
        imageBuffer = await fs.readFile(imagePath);
    } catch (e) {
        const err = new Error('Image file not found.');
        err.status = 404;
        throw err;
    }

    return {
        base64: imageBuffer.toString('base64'),
        mimeType
    };
}

async function callGroqVision({ title, style, customText, mimeType, base64 }) {
    if (!process.env.GROQ_API_KEY) {
        const err = new Error('The GROQ_API_KEY secret is not available to the server.');
        err.status = 503;
        throw err;
    }

    const styleInstruction = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS['balanced'];
    let promptText = `Visually inspect this sports photograph and describe only what is clearly visible. The gallery title is "${title}".\n`;
    promptText += `Tone and style guideline: ${styleInstruction}\n`;
    if (customText && customText.trim()) {
        promptText += `Specific focus / user direction: ${customText.trim()}\n`;
    }
    promptText += `Avoid uncertain identities, questionable jersey numbers, or events outside the frame. Return only the description text.`;

    const groqResponse = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: GROQ_VISION_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: promptText },
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
                    ]
                }
            ],
            reasoning_effort: 'none',
            max_tokens: 400,
            temperature: 0.35,
        }),
    });

    const result = await groqResponse.json().catch(() => ({}));
    if (!groqResponse.ok) {
        console.error('Groq API request failed:', groqResponse.status, result);
        const err = new Error('The description service could not complete the request.');
        err.status = 502;
        throw err;
    }

    const description = result.choices?.[0]?.message?.content;
    if (typeof description !== 'string' || !description.trim()) {
        console.error('Groq API returned no description.');
        const err = new Error('The description service returned an empty response.');
        err.status = 502;
        throw err;
    }

    return description.trim();
}

async function describePhoto(request, response) {
    let body;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        sendJson(response, 400, { error: error.message });
        return;
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const imageSrc = typeof body.imageSrc === 'string' ? body.imageSrc.trim() : '';
    
    if (!title || title.length > 200) {
        sendJson(response, 400, {
            error: 'A photo title between 1 and 200 characters is required.',
        });
        return;
    }

    if (!imageSrc) {
        sendJson(response, 400, {
            error: 'An image source is required.',
        });
        return;
    }

    const imageKey = path.basename(imageSrc);
    const descriptions = loadDescriptions();
    const record = getImageRecord(descriptions, imageKey);

    // Return cached / existing description if available
    if (record.current) {
        sendJson(response, 200, { 
            description: record.current,
            history: record.history,
            cached: true 
        });
        return;
    }

    if (!process.env.GROQ_API_KEY) {
        sendJson(response, 503, {
            error: 'The GROQ_API_KEY secret is not available to the server.',
        });
        return;
    }

    try {
        const encoded = await readAndEncodeImage(imageSrc);
        const trimmedDescription = await callGroqVision({
            title,
            style: 'balanced',
            customText: '',
            mimeType: encoded.mimeType,
            base64: encoded.base64
        });
        
        record.current = trimmedDescription;
        record.lastStyle = 'balanced';
        record.lastStyleLabel = STYLE_LABELS['balanced'];
        descriptions[imageKey] = record;
        descriptions[`vision-v5:${imageKey}`] = trimmedDescription;
        saveDescriptions(descriptions);

        sendJson(response, 200, { 
            description: record.current,
            history: record.history,
            cached: false 
        });
    } catch (error) {
        console.error('Describe error:', error.message);
        sendJson(response, error.status || 502, {
            error: error.message || 'The description service is temporarily unavailable.',
        });
    }
}

async function regeneratePhoto(request, response) {
    let body;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        sendJson(response, 400, { error: error.message });
        return;
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const imageSrc = typeof body.imageSrc === 'string' ? body.imageSrc.trim() : '';
    const style = typeof body.style === 'string' && STYLE_INSTRUCTIONS[body.style] ? body.style : 'balanced';
    const customText = typeof body.customText === 'string' ? body.customText.trim() : '';

    if (!title || title.length > 200) {
        sendJson(response, 400, {
            error: 'A photo title between 1 and 200 characters is required.',
        });
        return;
    }

    if (!imageSrc) {
        sendJson(response, 400, {
            error: 'An image source is required.',
        });
        return;
    }

    if (customText.length > 100) {
        sendJson(response, 400, {
            error: 'Custom direction text cannot exceed 100 characters.',
        });
        return;
    }

    if (!process.env.GROQ_API_KEY) {
        sendJson(response, 503, {
            error: 'The GROQ_API_KEY secret is required to regenerate descriptions. Please configure it in Settings.',
        });
        return;
    }

    try {
        const encoded = await readAndEncodeImage(imageSrc);
        const newDescription = await callGroqVision({
            title,
            style,
            customText,
            mimeType: encoded.mimeType,
            base64: encoded.base64
        });

        const descriptions = loadDescriptions();
        const imageKey = path.basename(imageSrc);
        const record = getImageRecord(descriptions, imageKey);

        // Save current description to history before overwriting
        if (record.current) {
            record.history.unshift({
                id: 'desc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                description: record.current,
                timestamp: new Date().toISOString(),
                style: record.lastStyle || 'balanced',
                styleLabel: record.lastStyleLabel || 'Previous Version',
                customText: record.lastCustomText || ''
            });
        }

        record.current = newDescription;
        record.lastStyle = style;
        record.lastStyleLabel = STYLE_LABELS[style];
        record.lastCustomText = customText;

        descriptions[imageKey] = record;
        descriptions[`vision-v5:${imageKey}`] = newDescription;
        saveDescriptions(descriptions);

        sendJson(response, 200, {
            description: record.current,
            history: record.history,
            cached: false
        });
    } catch (error) {
        console.error('Regenerate error:', error.message);
        sendJson(response, error.status || 502, {
            error: error.message || 'Could not regenerate description.',
        });
    }
}

async function restorePhoto(request, response) {
    let body;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        sendJson(response, 400, { error: error.message });
        return;
    }

    const imageSrc = typeof body.imageSrc === 'string' ? body.imageSrc.trim() : '';
    const historyId = typeof body.historyId === 'string' ? body.historyId.trim() : '';

    if (!imageSrc || !historyId) {
        sendJson(response, 400, { error: 'Both imageSrc and historyId are required.' });
        return;
    }

    const descriptions = loadDescriptions();
    const imageKey = path.basename(imageSrc);
    const record = getImageRecord(descriptions, imageKey);

    const historyIndex = record.history.findIndex(h => h.id === historyId);
    if (historyIndex === -1) {
        sendJson(response, 404, { error: 'Historical description not found.' });
        return;
    }

    const restoredItem = record.history[historyIndex];
    const previousCurrent = record.current;

    // Remove restored item from history
    record.history.splice(historyIndex, 1);

    // Save previous current description to history so it can be restored again if desired
    if (previousCurrent && previousCurrent !== restoredItem.description) {
        record.history.unshift({
            id: 'desc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            description: previousCurrent,
            timestamp: new Date().toISOString(),
            style: record.lastStyle || 'balanced',
            styleLabel: 'Previous Current',
            customText: record.lastCustomText || ''
        });
    }

    record.current = restoredItem.description;
    record.lastStyle = restoredItem.style || 'restored';
    record.lastStyleLabel = restoredItem.styleLabel || 'Restored Version';
    record.lastCustomText = restoredItem.customText || '';

    descriptions[imageKey] = record;
    descriptions[`vision-v5:${imageKey}`] = record.current;
    saveDescriptions(descriptions);

    sendJson(response, 200, {
        description: record.current,
        history: record.history
    });
}

async function serveStatic(request, response, pathname) {
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    let filePath;

    try {
        filePath = path.resolve(PUBLIC_ROOT, `.${requestedPath}`);
    } catch {
        response.writeHead(400);
        response.end('Bad request');
        return;
    }

    if (filePath !== PUBLIC_ROOT && !filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    try {
        const file = await fs.readFile(filePath);
        const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(file);
    } catch (error) {
        const status = error.code === 'ENOENT' ? 404 : 500;
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(status === 404 ? 'Not found' : 'Internal server error');
    }
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/api/describe') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
        }
        await describePhoto(request, response);
        return;
    }

    if (url.pathname === '/api/regenerate') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
        }
        await regeneratePhoto(request, response);
        return;
    }

    if (url.pathname === '/api/restore') {
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
        }
        await restorePhoto(request, response);
        return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Method not allowed');
        return;
    }

    await serveStatic(request, response, decodeURIComponent(url.pathname));
});

server.listen(PORT, HOST, () => {
    console.log(`Photo gallery server listening on ${HOST}:${PORT}`);
});
