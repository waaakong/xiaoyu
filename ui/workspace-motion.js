// Occasional transitions explain spatial changes. Frequent controls use CSS
// press feedback, and keyboard navigation commits immediately.
export function installWorkspaceMotion() {
  const gsap = window.gsap;
  if (!gsap) return;
  const reduced = () => window.xyMotionDisabled?.() ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  let keyboard = false;
  document.addEventListener('keydown', () => { keyboard = true; }, true);
  document.addEventListener('pointerdown', () => { keyboard = false; }, true);
  window.xyKeyboardNavigation = () => keyboard;
  const animations = new Map();
  const clean = element => {
    for (const property of ['transform', 'opacity', 'will-change']) element.style.removeProperty(property);
  };
  const observer = new MutationObserver(records => {
    for (const { target } of records) {
      if (!(target instanceof HTMLDialogElement)) continue;
      animations.get(target)?.kill();
      animations.delete(target);
      clean(target);
      if (!target.open || reduced() || keyboard) continue;
      target.style.willChange = 'transform,opacity';
      const tween = gsap.fromTo(target, { y: 10, scale: .98, opacity: .3 }, {
        y: 0, scale: 1, opacity: 1, duration: .22, ease: 'power3.out', overwrite: 'auto',
        onComplete: () => { clean(target); animations.delete(target); }
      });
      animations.set(target, tween);
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    for (const [element, tween] of animations) { tween.kill(); clean(element); }
    animations.clear();
  }, { once: true });
}
