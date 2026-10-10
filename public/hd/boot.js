/* Loads the Night Circuit renderer ahead of the game. A static import, so
   this module does not finish until the renderer and three.js are in; the game
   script is deferred behind it, so by the time it reads window.HURTLE_HD the
   renderer is either here or deliberately absent. If anything in the import
   graph fails, this module fails, HURTLE_HD stays unset and the game paints
   its own 2D canvas. WebGL is probed first for the same reason. */
import renderer from './renderer.js';
(function(){
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return;
    const lose = g.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();   // the probe is not the renderer's context
  } catch (e) { return; }
  window.HURTLE_HD = renderer;
})();
