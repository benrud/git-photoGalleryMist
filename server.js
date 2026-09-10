const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';
const PUBLIC_ROOT = path.resolve(__dirname);
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

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
    if (!title || title.length > 200) {
        sendJson(response, 400, {
            error: 'A photo title between 1 and 200 characters is required.',
        });
        return;
    }

    try {
        const groqResponse = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                reasoning_effort: 'low',
                messages: [
                    {
                        role: 'user',
                        content: `Describe the following photo in 2-3 sentences. The photo title is: "${title}". Be creative and vivid.`,
                    },
                ],
                max_tokens: 300,
                temperature: 0.7,
            }),
        });

        const result = await groqResponse.json().catch(() => ({}));
        if (!groqResponse.ok) {
            console.error('Groq API request failed:', groqResponse.status);
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

        sendJson(response, 200, { description: description.trim() });
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