document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("page-ready");
});

const slides = document.querySelectorAll('.slide');
const dots = document.querySelectorAll('.dot');
const prevBtn = document.querySelector('.slider-arrow.prev');
const nextBtn = document.querySelector('.slider-arrow.next');

let currentIndex = 0;
let autoPlay = null;



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
  stopAutoPlay();
  autoPlay = setInterval(nextSlide, 3500);
}

function stopAutoPlay() {
  if (autoPlay) {
    clearInterval(autoPlay);
  }
}

if (slides.length > 0 && dots.length > 0) {
  showSlide(0);

  prevBtn?.addEventListener('click', () => {
    prevSlide();
    startAutoPlay();
  });

  nextBtn?.addEventListener('click', () => {
    nextSlide();
    startAutoPlay();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      showSlide(index);
      startAutoPlay();
    });
  });

  startAutoPlay();
}
