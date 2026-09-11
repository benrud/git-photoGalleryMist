// Load photos from JSON and populate gallery
document.addEventListener('DOMContentLoaded', async () => {
    const cards = document.querySelectorAll('.photo-card');

    try {
        const response = await fetch('photos.json');
        if (response.ok) {
            const data = await response.json();
            data.photos.forEach((photo, index) => {
                if (cards[index]) {
                    const img = cards[index].querySelector('img');
                    const h3 = cards[index].querySelector('h3');
                    if (img) {
                        img.src = photo.src || '';
                        img.alt = photo.title || `Photo ${photo.id}`;
                    }
                    if (h3) {
                        h3.textContent = photo.title || '';
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error loading photos:', error);
    }
});
