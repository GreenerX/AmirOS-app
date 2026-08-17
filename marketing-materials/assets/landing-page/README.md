# AmirOS Early Access landing page

The production page is a dependency-free static Netlify site:

- `index.html` — complete landing-page narrative and Netlify early-access form.
- `styles.v4.css` — responsive design system and reduced-motion support.
- `motion.js` — accessible question examples, restrained scroll reveals, header behavior, and subtle product depth.
- `thanks.html` — form success destination.
- `ASSET-MANIFEST.md` — canonical brand and product-image source of truth.

Below 600px, the page uses dedicated mobile product photography created from the real 1920px AmirOS captures. This keeps the relevant People cards, relationship context, Today's Focus, Ask answer, and reply-mode controls complete and legible rather than mechanically cropping the desktop frame.

The page uses real AmirOS v0.10.0 UI captures with a fictional U.S. demo universe. Product behavior is not redrawn or fabricated. `amiros-mark-v2-cropped.png` is copied unchanged from the mark rendered by the current application.

The beta form is configured for Netlify Forms with full name, email, and one optional interest question. Local static servers can validate the fields and destination, but successful form capture must be verified in a Netlify deploy preview before launch.

The server-side beta application handoff and deployment requirements are documented outside the public `assets/` directory in `marketing-materials/README.md`.

The `concepts/relationship-v3/` images are art-direction references only and are not shipped in the public page experience.
