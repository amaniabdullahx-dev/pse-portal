(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    if (!window.gsap || !window.ScrollTrigger) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    var slides = gsap.utils.toArray('.slide');
    if (!slides.length) return;

    slides.forEach(function (slide) {
      var isPinned = slide.classList.contains('slide-pin');
      var bg = slide.querySelector('.story-bg');
      var lines = slide.querySelectorAll('.slide-content .line > span, .slide-content .line > a');
      var revealEls = slide.querySelectorAll('.reveal');

      if (isPinned) {
        // Pin the slide for one viewport of scroll while the next slide rises over it.
        ScrollTrigger.create({
          trigger: slide,
          start: 'top top',
          end: '+=100%',
          pin: true,
        });

        if (bg) {
          gsap.fromTo(
            bg,
            { scale: 1.12 },
            {
              scale: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: slide,
                start: 'top top',
                end: '+=100%',
                scrub: true,
              },
            }
          );
        }

        gsap.timeline({
          scrollTrigger: {
            trigger: slide,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          },
        }).to(lines, {
          y: 0,
          duration: 1,
          ease: 'power3.out',
          stagger: 0.1,
        });
      } else {
        // Natural-height slide: kinetic text reveal fires once as the headline enters view.
        if (lines.length) {
          gsap.timeline({
            scrollTrigger: {
              trigger: slide,
              start: 'top 75%',
              toggleActions: 'play none none none',
            },
          }).to(lines, {
            y: 0,
            duration: 1,
            ease: 'power3.out',
            stagger: 0.1,
          });
        }

        // Content blocks below the headline (cards, accordion, stats, partnership) fade + rise
        // individually as each one scrolls into view.
        revealEls.forEach(function (el) {
          gsap.to(el, {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 85%',
              toggleActions: 'play none none none',
            },
          });
        });
      }
    });

    ScrollTrigger.refresh();

        // Images/webfonts can finish loading after DOMContentLoaded and shift layout,
        // which leaves early trigger positions (esp. above-the-fold content) stale.
        // Re-measure once everything has actually finished loading. If the page is
        // already fully loaded (e.g. assets served from cache) the 'load' event may
        // never fire after this point, so check readyState directly as well.
        if (document.readyState === 'complete') {
                ScrollTrigger.refresh();
        } else {
                window.addEventListener('load', function () {
                          ScrollTrigger.refresh();
                });
        }

        // Belt-and-braces: fonts can swap in after 'load' too (FOFT/FOIT), which can
        // still shift line heights slightly. Do one more pass once fonts are ready.
        if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function () {
                          ScrollTrigger.refresh();
                });
        }
  });
})();
