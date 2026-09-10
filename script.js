// Simple photo gallery interaction
document.addEventListener('DOMContentLoaded', () => {
    const cards = document.querySelectorAll('.photo-card');
    
    cards.forEach(card => {
        card.addEventListener('click', () => {
            card.classList.toggle('active');
        });
    });
});
