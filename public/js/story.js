(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    if (!window.gsap || !window.ScrollTrigger) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    var panels = gsap.utils.toArray('.story-scroll .story-panel');
    if (!panels.length) return;

    panels.forEach(function (panel, i) {
      var bg = panel.querySelector('.story-bg');
      var lines = panel.querySelectorAll('.story-content .line > span, .story-content .line > a');

      // Pin the panel for one viewport of scroll while the next panel rises over it.
      ScrollTrigger.create({
        trigger: panel,
        start: 'top top',
        end: '+=100%',
        pin: true,
        pinSpacing: i === panels.length - 1,
      });

      // Slow Ken Burns drift on the background image, tied to the panel's own scroll.
      gsap.fromTo(
        bg,
        { scale: 1.12 },
        {
          scale: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: panel,
            start: 'top top',
            end: '+=100%',
            scrub: true,
          },
        }
      );

      // Kinetic text: each line rises from below and fades in as the panel enters view.
      gsap.timeline({
        scrollTrigger: {
          trigger: panel,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        },
      }).to(lines, {
        y: 0,
        duration: 1,
        ease: 'power3.out',
        stagger: 0.1,
      });
    });

    ScrollTrigger.refresh();
  });
})();
