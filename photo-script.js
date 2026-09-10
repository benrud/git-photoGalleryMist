// Get photo ID from filename (e.g., photo1.html -> 1)
const getPhotoId = () => {
    const path = window.location.pathname;
    const filename = path.split('/').pop();
    const match = filename.match(/^photo(\d+)\.html$/);
    return match ? parseInt(match[1]) : null;
};

// Fetch the AI-generated description through the server.
async function fetchAIDescription(title, imageSrc) {
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
            throw new Error(data.error || `Description service error: ${response.status}`);
        }

        return data.description;
    } catch (error) {
        console.error('Error fetching AI description:', error);
        return 'Could not load AI description. Please try again later.';
    }
}

// Load photo data and description
document.addEventListener('DOMContentLoaded', async () => {
    const photoId = getPhotoId();
    if (!photoId) {
        document.getElementById('photo-description').textContent = 'Photo not found.';
        return;
    }

    // In a real implementation, you would fetch the photo data from a JSON file
    // or database. For now, we'll use placeholder logic.
    // When you add your photos, update this to match your actual data.
    
    // Example: You could have a photos.json file with:
    // {
    //   "photos": [
    //     { "id": 1, "title": "My Photo", "src": "images/photo1.jpg" },
    //     ...
    //   ]
    // }
    
    // Fetch photo data from photos.json
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
    
    document.getElementById('photo-title').textContent = title;
    document.getElementById('photo-image').src = src;
    document.getElementById('photo-image').alt = title;

    // Fetch AI description
    const description = await fetchAIDescription(title, src);
    document.getElementById('photo-description').textContent = description;
});
