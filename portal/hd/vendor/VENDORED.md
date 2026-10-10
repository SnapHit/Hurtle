# Vendored for the Night Circuit renderer

- three.js r170, MIT (LICENSE.three): `three.module.min.js`, and from
  `examples/jsm/`: postprocessing/{EffectComposer, RenderPass, UnrealBloomPass,
  ShaderPass, OutputPass, MaskPass, Pass}.js and shaders/{RGBShiftShader,
  CopyShader, LuminosityHighPassShader, OutputShader}.js. The bare `three`
  specifier the addons import resolves through the import map the build writes.
- Every file is upstream verbatim except that 6 comment lines carrying a web
  address were removed from the addons, so `hd/vendor` contains no `http`
  URL beyond the two XML namespace strings (`www.w3.org/2000/svg` in the game,
  `www.w3.org/1999/xhtml` inside three.js), which browsers never fetch. No code
  changed; `diff` against the npm package shows only those lines. The only
  other addresses in a portal zip are inside the two font licences under
  `hd/fonts`, which the OFL requires to travel with the fonts as written; the
  build reads every text member, names those two files, and fails on any other.
