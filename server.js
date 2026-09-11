const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');

const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';
const PUBLIC_ROOT = path.resolve(__dirname);
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llava-1.5-7b';
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

async function readJsonBody(request) {
    let body = '';

    for await (const chunk of request) {
        body += chunk;
        if (body.length > 16_384) {
            throw new Error('Request body is too large.');
        }
    }

    try {
        return JSON.parse(body || '{}');
    } catch {
        throw new Error('Request body must be valid JSON.');
    }
}

async function describePhoto(request, response) {
    if (!process.env.GROQ_API_KEY) {
        sendJson(response, 503, {
            error: 'The GROQ_API_KEY secret is not available to the server.',
        });
        return;
    }

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

    // Create a cache key based on the image filename
    const cacheKey = path.basename(imageSrc);
    const descriptions = loadDescriptions();
    
    // Return cached description if available
    if (descriptions[cacheKey]) {
        sendJson(response, 200, { 
            description: descriptions[cacheKey],
            cached: true 
        });
        return;
    }

    try {
        // Read and encode the image
        const imagePath = path.resolve(PUBLIC_ROOT, imageSrc.replace(/^\//, ''));
        let imageBase64 = '';
        
        try {
            const imageBuffer = await fs.readFile(imagePath);
            imageBase64 = imageBuffer.toString('base64');
        } catch (e) {
            console.error('Could not read image:', e.message);
            sendJson(response, 404, { error: 'Image file not found.' });
            return;
        }

        // Determine image MIME type
        const ext = path.extname(imagePath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

        const groqResponse = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { 
                                type: 'text', 
                                text: `Describe this photo in 2-3 sentences. The photo title is: "${title}". Be creative and vivid.` 
                            },
                            { 
                                type: 'image_url', 
                                image_url: `data:${mimeType};base64,${imageBase64}` 
                            }
                        ]
                    },
                ],
                max_tokens: 300,
                temperature: 0.7,
            }),
        });

        const result = await groqResponse.json().catch(() => ({}));
        if (!groqResponse.ok) {
            console.error('Groq API request failed:', groqResponse.status, result);
            sendJson(response, 502, {
                error: 'The description service could not complete the request.',
            });
            return;
        }

        const description = result.choices?.[0]?.message?.content;
        if (typeof description !== 'string' || !description.trim()) {
            console.error('Groq API returned no description.');
            sendJson(response, 502, {
                error: 'The description service returned an empty response.',
            });
            return;
        }

        const trimmedDescription = description.trim();
        
        // Save description to cache
        descriptions[cacheKey] = trimmedDescription;
        saveDescriptions(descriptions);

        sendJson(response, 200, { 
            description: trimmedDescription,
            cached: false 
        });
    } catch (error) {
        console.error('Groq API request error:', error.message);
        sendJson(response, 502, {
            error: 'The description service is temporarily unavailable.',
        });
    }
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
