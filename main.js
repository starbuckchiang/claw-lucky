const slides = document.querySelectorAll('.slide');
const dots = document.querySelectorAll('.dot');
const prevBtn = document.querySelector('.slider-arrow.prev');
const nextBtn = document.querySelector('.slider-arrow.next');

let currentIndex = 0;
let autoPlay;

function showSlide(index) {
  slides.forEach((slide, i) => {
    slide.classList.toggle('is-active', i === index);
  });

  dots.forEach((dot, i) => {
    dot.classList.toggle('is-active', i === index);
  });

  currentIndex = index;
}

function nextSlide() {
  const nextIndex = (currentIndex + 1) % slides.length;
  showSlide(nextIndex);
}

function prevSlide() {
  const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
  showSlide(prevIndex);
}

function startAutoPlay() {
  autoPlay = setInterval(nextSlide, 3500);
}

function stopAutoPlay() {
  clearInterval(autoPlay);
}

if (slides.length && dots.length) {
  prevBtn?.addEventListener('click', () => {
    prevSlide();
    stopAutoPlay();
    startAutoPlay();
  });

  nextBtn?.addEventListener('click', () => {
    nextSlide();
    stopAutoPlay();
    startAutoPlay();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      showSlide(index);
      stopAutoPlay();
      startAutoPlay();
    });
  });

  startAutoPlay();
}
